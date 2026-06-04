import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { requireUserFromRequest } from '@/lib/apiGuards';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { safeLog } from '@/lib/safeLogger';
import { getGroupLabel, isRemoteLabel } from '@/lib/deviceLabels';
import { callHaService } from '@/lib/homeAssistant';
import { SERVICE_RESOLVE_BINDING } from '@/lib/remoteManager';
import type { RemoteDeviceSummary, RemoteTargetSummary } from '@/types/remote';

function normalize(value: string | null | undefined) {
  return (value ?? '').toString().trim();
}

function buildHaCandidates(haConnection: {
  baseUrl: string;
  cloudUrl: string | null;
  longLivedToken: string;
}) {
  const candidates: Array<{ baseUrl: string; longLivedToken: string }> = [];
  const seen = new Set<string>();
  for (const value of [haConnection.cloudUrl, haConnection.baseUrl]) {
    const normalized = normalize(value).replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ baseUrl: normalized, longLivedToken: haConnection.longLivedToken });
  }
  return candidates;
}

function firstArea(device: { area?: string | null; areaName?: string | null }) {
  return normalize(device.areaName ?? device.area) || null;
}

function buildTargetSummary(
  devices: Awaited<ReturnType<typeof getDevicesForHaConnection>>,
  capability: RemoteDeviceSummary['capability']
): RemoteTargetSummary | null {
  const entityId = normalize(capability?.targetEntityId);
  const deviceId = normalize(capability?.targetDeviceId);

  const target =
    (entityId && devices.find((device) => normalize(device.entityId) === entityId)) ||
    (deviceId && devices.find((device) => normalize(device.deviceId) === deviceId)) ||
    null;

  if (!target) {
    return null;
  }

  return {
    targetId: entityId || deviceId || target.entityId,
    entityId: target.entityId,
    deviceId: target.deviceId ?? null,
    name: target.name,
    domain: target.domain,
    areaName: firstArea(target),
    label: target.label ?? null,
    labelCategory: target.labelCategory ?? null,
    state: target.state,
  };
}

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ error: 'Admin dashboards are observe-only.' }, { status: 403 });
  }

  const fresh = req.nextUrl.searchParams.get('fresh') === '1';

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

  let allDevices: Awaited<ReturnType<typeof getDevicesForHaConnection>>;
  try {
    allDevices = await getDevicesForHaConnection(haConnection.id, {
      bypassCache: fresh,
      labelsOnly: true,
      includeServicesForTarget: false,
    });
  } catch (err) {
    safeLog('error', '[api/remote-devices] Failed to fetch devices from HA', { error: err });
    return NextResponse.json(
      { error: 'Dinodia Hub did not respond when loading remote devices.' },
      { status: 502 }
    );
  }

  const tenantOwnedForHome = await getTenantOwnedTargetsForHome(user.homeId!, haConnection.id);
  const tenantOwnedForUser = await getTenantOwnedTargetsForUser(user.id, haConnection.id);
  const allTenantOwnedEntityIds = new Set(tenantOwnedForHome.entityIds);
  const ownTenantOwnedEntityIds = new Set(tenantOwnedForUser.entityIds);
  const allowedAreas = new Set((user.accessRules ?? []).map((rule) => rule.area));

  const remoteDevices = allDevices.filter((device) => {
    if (!isRemoteLabel(device)) return false;
    if (ownTenantOwnedEntityIds.has(device.entityId)) {
      return true;
    }
    if (allTenantOwnedEntityIds.has(device.entityId)) {
      return false;
    }
    return Boolean(firstArea(device) && allowedAreas.has(firstArea(device)!));
  });

  const candidates = buildHaCandidates(haConnection);
  const remoteSummaries: RemoteDeviceSummary[] = [];
  for (const device of remoteDevices) {
    const remoteDeviceId = normalize(device.deviceId) || device.entityId;
    let binding: RemoteDeviceSummary['binding'] = null;
    let capability: RemoteDeviceSummary['capability'] = null;
    for (const candidate of candidates) {
      try {
        const result = await callHaService(candidate, 'dinodia_remote_manager', SERVICE_RESOLVE_BINDING, {
          remote_device_id: remoteDeviceId,
        });
        binding = result?.binding ?? null;
        capability = result?.capability ?? null;
        break;
      } catch {
        capability = null;
      }
    }

    remoteSummaries.push({
      remoteDeviceId,
      entityId: device.entityId,
      deviceId: device.deviceId ?? null,
      name: device.name,
      state: device.state,
      area: device.area ?? null,
      areaName: device.areaName ?? null,
      label: getGroupLabel(device),
      labelCategory: device.labelCategory ?? null,
      labels: device.labels ?? [],
      domain: device.domain,
      attributes: device.attributes ?? {},
      binding,
      capability,
      target: buildTargetSummary(allDevices, capability),
    });
  }

  remoteSummaries.sort((left, right) => {
    const leftArea = normalize(left.areaName ?? left.area);
    const rightArea = normalize(right.areaName ?? right.area);
    if (leftArea !== rightArea) return leftArea.localeCompare(rightArea);
    return left.name.localeCompare(right.name);
  });

  return NextResponse.json({ remoteDevices: remoteSummaries });
}
