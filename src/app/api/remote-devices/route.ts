import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { requireUserFromRequest } from '@/lib/apiGuards';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { safeLog } from '@/lib/safeLogger';
import { REMOTE_LABEL } from '@/lib/deviceLabels';
import { callHaService, getDevicesWithLabelMetadata } from '@/lib/homeAssistant';
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
      labelsOnly: false,
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

  const candidates = buildHaCandidates(haConnection);
  let remoteMetadata: Awaited<ReturnType<typeof getDevicesWithLabelMetadata>> = [];
  for (const candidate of candidates) {
    try {
      remoteMetadata = await getDevicesWithLabelMetadata(candidate, REMOTE_LABEL);
      if (remoteMetadata.length > 0) break;
    } catch {
      remoteMetadata = [];
    }
  }

  const remoteSummaries: RemoteDeviceSummary[] = [];
  for (const remote of remoteMetadata) {
    const remoteDeviceId = normalize(remote.device_id);
    if (!remoteDeviceId) continue;

    const deviceMatches = allDevices.filter(
      (device) => normalize(device.deviceId) === remoteDeviceId
    );
    const representative =
      deviceMatches[0] ??
      allDevices.find((device) => normalize(device.entityId) === normalize(remote.entity_id)) ??
      null;

    if (deviceMatches.some((device) => ownTenantOwnedEntityIds.has(device.entityId))) {
      // keep
    } else if (deviceMatches.some((device) => allTenantOwnedEntityIds.has(device.entityId))) {
      continue;
    } else {
      const areaName = normalize(remote.area_name) || representative?.areaName || representative?.area || null;
      if (!(areaName && allowedAreas.has(areaName))) {
        continue;
      }
    }

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
      entityId:
        normalize(remote.entity_id) ||
        representative?.entityId ||
        remoteDeviceId,
      deviceId: remoteDeviceId,
      name: remote.name || representative?.name || remoteDeviceId,
      state: representative?.state ?? 'unknown',
      area: (normalize(remote.area_name) || representative?.area) ?? null,
      areaName: normalize(remote.area_name) || representative?.areaName || representative?.area || null,
      label: REMOTE_LABEL,
      labelCategory: REMOTE_LABEL,
      labels: remote.labels?.length ? remote.labels : [REMOTE_LABEL],
      domain: representative?.domain ?? 'remote',
      attributes: representative?.attributes ?? {},
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
