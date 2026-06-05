import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { requireUserFromRequest } from '@/lib/apiGuards';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { safeLog } from '@/lib/safeLogger';
import { REMOTE_LABEL } from '@/lib/deviceLabels';
import { callHaService, getDevicesWithLabelMetadata } from '@/lib/homeAssistant';
import { REMOTE_MANAGER_DOMAIN, SERVICE_UPDATE_BINDING } from '@/lib/remoteManager';

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

function compactServiceData(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
}

function targetIsAllowed(args: {
  target: Awaited<ReturnType<typeof getDevicesForHaConnection>>[number];
  ownTenantOwnedEntityIds: Set<string>;
  allTenantOwnedEntityIds: Set<string>;
  allowedAreas: Set<string>;
}) {
  const { target, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, allowedAreas } = args;
  if (ownTenantOwnedEntityIds.has(target.entityId)) return true;
  if (allTenantOwnedEntityIds.has(target.entityId)) return false;
  const areaName = firstArea(target);
  return Boolean(areaName && allowedAreas.has(areaName));
}

function remoteIsVisible(args: {
  remoteDeviceId: string;
  remoteAreaName: string | null;
  allDevices: Awaited<ReturnType<typeof getDevicesForHaConnection>>;
  ownTenantOwnedEntityIds: Set<string>;
  allTenantOwnedEntityIds: Set<string>;
  allowedAreas: Set<string>;
}) {
  const {
    remoteDeviceId,
    remoteAreaName,
    allDevices,
    ownTenantOwnedEntityIds,
    allTenantOwnedEntityIds,
    allowedAreas,
  } = args;
  const deviceMatches = allDevices.filter((device) => normalize(device.deviceId) === remoteDeviceId);
  if (deviceMatches.some((device) => ownTenantOwnedEntityIds.has(device.entityId))) return true;
  if (deviceMatches.some((device) => allTenantOwnedEntityIds.has(device.entityId))) return false;

  const representative = deviceMatches[0] ?? null;
  const areaName = normalize(remoteAreaName) || representative?.areaName || representative?.area || null;
  return Boolean(areaName && allowedAreas.has(areaName));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ remoteDeviceId: string }> }
) {
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

  const { remoteDeviceId: paramRemoteDeviceId } = await params;
  const remoteDeviceId = normalize(paramRemoteDeviceId);
  if (!remoteDeviceId) {
    return NextResponse.json({ error: 'Remote device is required.' }, { status: 400 });
  }

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

  if (!user.homeId) {
    return NextResponse.json({ error: 'Your home is not set up yet.' }, { status: 400 });
  }

  const payload = await req.json().catch(() => ({}));
  const bindingId = normalize(payload.bindingId ?? payload.binding_id) || null;
  const targetDeviceId = normalize(payload.targetDeviceId ?? payload.target_device_id) || null;
  const targetEntityId = normalize(payload.targetEntityId ?? payload.target_entity_id) || null;
  const bindingName = normalize(payload.bindingName ?? payload.binding_name) || null;

  if (!targetDeviceId && !targetEntityId) {
    return NextResponse.json({ error: 'Choose a target device or entity.' }, { status: 400 });
  }
  if (targetDeviceId === remoteDeviceId) {
    return NextResponse.json({ error: 'Remote and target cannot be the same device.' }, { status: 400 });
  }

  let allDevices: Awaited<ReturnType<typeof getDevicesForHaConnection>>;
  try {
    allDevices = await getDevicesForHaConnection(haConnection.id, {
      bypassCache: true,
      labelsOnly: false,
      includeServicesForTarget: false,
    });
  } catch (err) {
    safeLog('error', '[api/remote-devices/:id] Failed to fetch devices from HA', { error: err });
    return NextResponse.json(
      { error: 'Dinodia Hub did not respond when checking this target.' },
      { status: 502 }
    );
  }

  const tenantOwnedForHome = await getTenantOwnedTargetsForHome(user.homeId, haConnection.id);
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
  const remote = remoteMetadata.find((item) => normalize(item.device_id) === remoteDeviceId);
  if (!remote) {
    return NextResponse.json({ error: 'Remote device is not available.' }, { status: 404 });
  }
  if (
    !remoteIsVisible({
      remoteDeviceId,
      remoteAreaName: normalize(remote.area_name) || null,
      allDevices,
      ownTenantOwnedEntityIds,
      allTenantOwnedEntityIds,
      allowedAreas,
    })
  ) {
    return NextResponse.json({ error: 'Remote device is not available.' }, { status: 404 });
  }

  const target =
    (targetEntityId && allDevices.find((device) => device.entityId === targetEntityId)) ||
    (targetDeviceId && allDevices.find((device) => normalize(device.deviceId) === targetDeviceId)) ||
    null;
  if (!target) {
    return NextResponse.json({ error: 'Target is not available.' }, { status: 400 });
  }
  if (!targetIsAllowed({ target, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, allowedAreas })) {
    return NextResponse.json({ error: 'Target is not available.' }, { status: 403 });
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const result = await callHaService(
        candidate,
        REMOTE_MANAGER_DOMAIN,
        SERVICE_UPDATE_BINDING,
        compactServiceData({
          binding_id: bindingId,
          remote_device_id: remoteDeviceId,
          target_device_id: targetDeviceId,
          target_entity_id: targetEntityId,
          binding_name: bindingName,
        }),
        undefined,
        { returnResponse: true }
      );
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      lastError = err;
    }
  }

  safeLog('error', '[api/remote-devices/:id] Failed to update remote binding', {
    userId: user.id,
    remoteDeviceId,
    targetEntityId,
    targetDeviceId,
    error: lastError,
  });
  return NextResponse.json(
    { error: 'Dinodia Hub did not respond when updating this remote.' },
    { status: 502 }
  );
}
