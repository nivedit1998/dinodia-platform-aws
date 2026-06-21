import { NextRequest, NextResponse } from 'next/server';
import { requireUserFromRequest } from '@/lib/apiGuards';
import { Role } from '@prisma/client';
import { logApiHit } from '@/lib/requestLog';
import { safeLog } from '@/lib/safeLogger';
import {
  inferTenantOwnerFromTechnicalName,
  isOwnedByAnotherTenantDeviceFirst,
  isOwnedByTenantDeviceFirst,
} from '@/lib/tenantOwnership';
import { TENANT_DEVICE_LABEL_ID } from '@/lib/haLabels';
import { getEntityRegistryMap } from '@/lib/homeAssistant';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { prisma } from '@/lib/prisma';
import { getTenantDashboardDevices } from '@/lib/deviceCapabilities';
import { isIgnoredDashboardHelperEntity } from '@/lib/dashboardEntityFilters';
import { getTriggerDeviceDashboardContextForTenant } from '@/lib/triggerDevices';
import { buildHaCandidates, getTenantInventoryBootstrap } from '@/lib/tenantInventoryBootstrap';

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

  let bootstrap;
  try {
    bootstrap = await getTenantInventoryBootstrap(me.id, {
      fresh: bypassCache,
      includeServicesForTarget,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  const {
    user,
    haConnection,
    labelledDevices: devices,
    ownershipIndex,
    sourceAreaByEntity,
    hasAreaAccess,
  } = bootstrap;

  const result = devices.filter((device) => {
    if (isIgnoredDashboardHelperEntity(device)) return false;

    const rawLabels = device.technicalLabels ?? device.labels ?? [];
    const hasTenantLabel = rawLabels.includes(TENANT_DEVICE_LABEL_ID);
    const pending =
      (device.deviceId ? ownershipIndex.pendingDeviceIds.has(device.deviceId) : false) ||
      ownershipIndex.pendingEntityIds.has(device.entityId);
    if (pending) return false;

    if (isOwnedByTenantDeviceFirst(device, ownershipIndex, user.id)) {
      return true;
    }

    if (isOwnedByAnotherTenantDeviceFirst(device, ownershipIndex, user.id)) {
      return false;
    }

    if (hasTenantLabel) {
      const ownerFromName = inferTenantOwnerFromTechnicalName(device.name);
      if (ownerFromName !== user.id) return false;
    }

    return hasAreaAccess(sourceAreaByEntity.get(device.entityId) ?? device.areaName);
  });

  // Merge non-helper linked entities by deviceId, but keep diagnostic/helper entities out of
  // normal dashboard cards. Battery percentages are enriched below from monitoring snapshots.
  let finalResult = result;
  const allowedDeviceIds = new Set(
    result
      .map((d) => (d.deviceId ?? '').toString().trim())
      .filter((v) => v.length > 0)
  );
  if (allowedDeviceIds.size > 0) {
    const merged = new Map(result.map((d) => [d.entityId, d]));
    for (const device of devices) {
      if (isIgnoredDashboardHelperEntity(device)) continue;

      const deviceId = (device.deviceId ?? '').toString().trim();
      if (!deviceId || !allowedDeviceIds.has(deviceId)) continue;
      const pending =
        ownershipIndex.pendingDeviceIds.has(deviceId) ||
        ownershipIndex.pendingEntityIds.has(device.entityId);
      if (pending) continue;
      if (isOwnedByTenantDeviceFirst(device, ownershipIndex, user.id)) {
        merged.set(device.entityId, device);
        continue;
      }
      if (isOwnedByAnotherTenantDeviceFirst(device, ownershipIndex, user.id)) {
        continue;
      }
      const rawLabels = device.technicalLabels ?? device.labels ?? [];
      if (rawLabels.includes(TENANT_DEVICE_LABEL_ID)) continue;
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

  const resolvedDevices = finalResult;

  let triggerDevicesPreview: Awaited<
    ReturnType<typeof getTriggerDeviceDashboardContextForTenant>
  >['triggerDevices'] = [];
  let acceptedTriggerDeviceIds: string[] = [];

  try {
    const preview = await getTriggerDeviceDashboardContextForTenant({
      userId: me.id,
      fresh: bypassCache,
      includeTargetOptions: false,
    });
    triggerDevicesPreview = preview.triggerDevices;
    acceptedTriggerDeviceIds = preview.acceptedTriggerDeviceIds;
  } catch (err) {
    safeLog('warn', '[api/devices] trigger preview unavailable; continuing with devices only', {
      error: err,
    });
  }

  const acceptedTriggerIdSet = new Set(
    acceptedTriggerDeviceIds
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
  const filteredResolvedDevices = resolvedDevices.filter((device) => {
    const identity = (device.deviceId ?? device.entityId ?? '').trim().toLowerCase();
    if (!identity) return true;
    return !acceptedTriggerIdSet.has(identity);
  });

  return NextResponse.json({
    devices: filteredResolvedDevices,
    triggerDevicesPreview,
    acceptedTriggerDeviceIds,
  });
}
