import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/lib/apiGuards';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { Role } from '@prisma/client';
import { logApiHit } from '@/lib/requestLog';
import { safeLog } from '@/lib/safeLogger';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { getEntityRegistryMap } from '@/lib/homeAssistant';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { prisma } from '@/lib/prisma';
import { getTenantDashboardDevices } from '@/lib/deviceCapabilities';

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function buildHaCandidates(haConnection: {
  baseUrl: string;
  cloudUrl: string | null;
  longLivedToken: string;
}): HaConnectionLike[] {
  const candidates: HaConnectionLike[] = [];
  const seen = new Set<string>();
  const cloud = haConnection.cloudUrl ? normalizeUrl(haConnection.cloudUrl) : '';
  const base = normalizeUrl(haConnection.baseUrl);

  if (cloud && !seen.has(cloud)) {
    candidates.push({ baseUrl: cloud, longLivedToken: haConnection.longLivedToken });
    seen.add(cloud);
  }
  if (base && !seen.has(base)) {
    candidates.push({ baseUrl: base, longLivedToken: haConnection.longLivedToken });
  }

  return candidates;
}

async function getEntityRegistryMapForConnection(haConnection: {
  id: number;
  baseUrl: string;
  cloudUrl: string | null;
  longLivedToken: string;
}) {
  const candidates = buildHaCandidates(haConnection);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await getEntityRegistryMap(candidate);
    } catch (err) {
      lastError = err;
    }
  }
  safeLog('warn', '[api/devices] entity registry fetch failed; battery bars may be missing', {
    haConnectionId: haConnection.id,
    error: lastError,
  });
  return new Map<string, string | null>();
}

function parsePercentLike(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/%$/, '').trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampPercent(value: unknown) {
  const parsed = parsePercentLike(value);
  if (parsed == null) return null;
  if (parsed < 0 || parsed > 100) return null;
  return Math.round(parsed);
}

export async function GET(req: NextRequest) {
  logApiHit(req, '/api/devices', { fresh: req.nextUrl.searchParams.get('fresh') === '1' });

  let me;
  try {
    me = await requireUserFromRequest(req);
  } catch {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (me.role === Role.ADMIN) {
    return NextResponse.json(
      { error: 'Admin dashboards are observe-only.' },
      { status: 403 }
    );
  }

  const fresh = req.nextUrl.searchParams.get('fresh');
  const bypassCache = fresh === '1';
  const includeServicesForTarget =
    req.nextUrl.searchParams.get('include_services_for_target') === '1';

  let user;
  let haConnection;
  try {
    ({ user, haConnection } = await getUserWithHaConnection(me.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  let devices: Awaited<ReturnType<typeof getDevicesForHaConnection>>;
  try {
    devices = await getDevicesForHaConnection(haConnection.id, {
      bypassCache,
      labelsOnly: true,
      includeServicesForTarget,
    });
  } catch (err) {
    safeLog('error', '[api/devices] Failed to fetch devices from HA', { error: err });
    return NextResponse.json(
      { error: 'Dinodia Hub did not respond when loading devices.' },
      { status: 502 }
    );
  }

  const tenantOwnedForHome = await getTenantOwnedTargetsForHome(user.homeId!, haConnection.id);
  const tenantOwnedForUser = await getTenantOwnedTargetsForUser(user.id, haConnection.id);
  const allTenantOwnedEntityIds = new Set(tenantOwnedForHome.entityIds);
  const ownTenantOwnedEntityIds = new Set(tenantOwnedForUser.entityIds);
  const allowedAreas = new Set((user.accessRules ?? []).map((rule) => rule.area));

  const result = devices.filter((device) => {
    if (ownTenantOwnedEntityIds.has(device.entityId)) {
      return true;
    }

    if (allTenantOwnedEntityIds.has(device.entityId)) {
      return false;
    }

    return Boolean(device.areaName && allowedAreas.has(device.areaName));
  });

  // Ensure linked sensor entities (e.g., battery %) are returned even when they lack areaName metadata.
  // Tenant dashboards derive battery by grouping entities via deviceId; without this, cloud mode may omit
  // a battery sensor even though the primary controllable entity is visible.
  let finalResult = result;
  const allowedDeviceIds = new Set(
    result
      .map((d) => (d.deviceId ?? '').toString().trim())
      .filter((v) => v.length > 0)
  );
  if (allowedDeviceIds.size > 0) {
    const merged = new Map(result.map((d) => [d.entityId, d]));
    for (const device of devices) {
      const deviceId = (device.deviceId ?? '').toString().trim();
      if (!deviceId || !allowedDeviceIds.has(deviceId)) continue;
      if (ownTenantOwnedEntityIds.has(device.entityId)) {
        merged.set(device.entityId, device);
        continue;
      }
      if (allTenantOwnedEntityIds.has(device.entityId)) {
        continue;
      }
      merged.set(device.entityId, device);
    }
    finalResult = Array.from(merged.values());
  }

  // Phase 2: Cloud-mode tenant dashboards may not have battery sensor entities in the device list.
  // Attach `batteryPercent` based on the latest MonitoringReading battery snapshots so both:
  // - dinodia-platform tenant dashboard, and
  // - dinodia-ios-app cloud mode tenant dashboard
  // can render battery bars without scanning linked sensor entities client-side.
  const tenantTileDeviceIds = new Set(
    getTenantDashboardDevices(finalResult)
      .map((d) => (d.deviceId ?? '').toString().trim())
      .filter((v) => v.length > 0)
  );
  if (tenantTileDeviceIds.size > 0) {
    try {
      const [registryMap, batteryRows] = await Promise.all([
        getEntityRegistryMapForConnection(haConnection),
        prisma.monitoringReading.findMany({
          where: {
            haConnectionId: haConnection.id,
            unit: '%',
            entityId: { contains: 'battery', mode: 'insensitive' },
          },
          orderBy: [{ entityId: 'asc' }, { capturedAt: 'desc' }],
          distinct: ['entityId'],
          select: { entityId: true, numericValue: true, state: true, capturedAt: true },
        }),
      ]);

      const batteryPercentByDeviceId = new Map<string, number>();
      for (const row of batteryRows) {
        const deviceId = (registryMap.get(row.entityId) ?? '').toString().trim();
        if (!deviceId || !tenantTileDeviceIds.has(deviceId)) continue;
        const pct = clampPercent(row.numericValue ?? row.state);
        if (pct == null) continue;
        const existing = batteryPercentByDeviceId.get(deviceId);
        if (existing == null || pct < existing) {
          batteryPercentByDeviceId.set(deviceId, pct);
        }
      }

      if (batteryPercentByDeviceId.size > 0) {
        finalResult = finalResult.map((device) => {
          const deviceId = (device.deviceId ?? '').toString().trim();
          if (!deviceId) return device;
          if (!tenantTileDeviceIds.has(deviceId)) return device;
          const batteryPercent = batteryPercentByDeviceId.get(deviceId) ?? null;
          return { ...device, batteryPercent };
        });
      }
    } catch (err) {
      safeLog('warn', '[api/devices] failed to enrich battery percent; continuing', {
        haConnectionId: haConnection.id,
        error: err,
      });
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const interestingLabels = new Set(['Motion Sensor', 'TV', 'Spotify']);
    const sample = result.filter((d) => {
      const labels = Array.isArray(d.labels) ? d.labels : [];
      const candidates = [
        d.label ?? '',
        ...labels,
        d.labelCategory ?? '',
      ].map((lbl) => (lbl ? lbl.toString().trim() : ''));
      return candidates.some((lbl) => interestingLabels.has(lbl));
    });
    if (sample.length > 0) {
      safeLog('debug', '[api/devices] sample summary', {
        sampleCount: sample.length,
        resultCount: result.length,
      });
    }
  }

  return NextResponse.json({ devices: finalResult });
}
