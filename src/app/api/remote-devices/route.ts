import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { requireUserFromRequest } from '@/lib/apiGuards';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { safeLog } from '@/lib/safeLogger';
import { REMOTE_LABEL } from '@/lib/deviceLabels';
import { callHaService, getDevicesWithLabelMetadata } from '@/lib/homeAssistant';
import { SERVICE_LIST_BINDINGS, SERVICE_RESOLVE_BINDING } from '@/lib/remoteManager';
import type { RemoteDeviceSummary, RemoteTargetSummary } from '@/types/remote';

function normalize(value: string | null | undefined) {
  return (value ?? '').toString().trim();
}

function normalizeIdentifier(value: string | null | undefined) {
  return normalize(value).toLowerCase();
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
  binding: RemoteDeviceSummary['binding'],
  capability: RemoteDeviceSummary['capability']
): RemoteTargetSummary | null {
  const entityId = normalize(capability?.targetEntityId || binding?.targetEntityId);
  const deviceId = normalize(capability?.targetDeviceId || binding?.targetDeviceId);

  const target =
    (entityId && devices.find((device) => normalize(device.entityId) === entityId)) ||
    (deviceId && devices.find((device) => normalize(device.deviceId) === deviceId)) ||
    null;

  if (target) {
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

  if (entityId || deviceId || binding || capability) {
    return {
      targetId: entityId || deviceId || binding?.bindingId || 'unresolved',
      entityId: entityId || null,
      deviceId: deviceId || null,
      name:
        binding?.bindingName ||
        capability?.description ||
        entityId ||
        deviceId ||
        'Target unresolved',
      domain: capability?.domain || 'unknown',
      areaName: null,
      label: capability?.targetKind || binding?.targetKind || null,
      labelCategory: capability?.targetKind || binding?.targetKind || null,
      state: 'unresolved',
    };
  }

  return null;
}

type ResolveBindingResponse = {
  binding?: RemoteDeviceSummary['binding'] | null;
  capability?: RemoteDeviceSummary['capability'] | null;
};

type ListBindingsResponse = {
  bindings?: RemoteDeviceSummary['binding'][];
};

type BindingResolutionState = 'bound' | 'target_unresolved' | 'unbound' | 'unresolved';

type BindingResolution = {
  binding: RemoteDeviceSummary['binding'] | null;
  capability: RemoteDeviceSummary['capability'] | null;
  resolutionState: BindingResolutionState;
};

function mergeBindingInventory(bindings: RemoteDeviceSummary['binding'][]) {
  const seen = new Map<string, RemoteDeviceSummary['binding']>();
  for (const binding of bindings) {
    if (!binding?.bindingId) continue;
    if (!seen.has(binding.bindingId)) {
      seen.set(binding.bindingId, binding);
    }
  }
  return [...seen.values()];
}

function findBindingForRemote(
  bindings: RemoteDeviceSummary['binding'][],
  remoteDeviceId: string,
  remoteEntityId: string | null
) {
  const remoteDeviceKey = normalizeIdentifier(remoteDeviceId);
  const remoteEntityKey = normalizeIdentifier(remoteEntityId);
  return (
    bindings.find((item) => normalizeIdentifier(item?.remoteDeviceId) === remoteDeviceKey) ??
    bindings.find((item) => normalizeIdentifier(item?.bindingId) === remoteDeviceKey) ??
    (remoteEntityKey
      ? bindings.find((item) => normalizeIdentifier(item?.remoteDeviceId) === remoteEntityKey) ??
        bindings.find((item) => normalizeIdentifier(item?.bindingId) === remoteEntityKey)
      : null) ??
    null
  );
}

async function resolveRemoteBinding(
  candidate: { baseUrl: string; longLivedToken: string },
  remoteDeviceId: string,
  remoteEntityId: string | null,
  bindingHint: RemoteDeviceSummary['binding'] | null = null
): Promise<BindingResolution | null> {
  try {
    const result = await callHaService(
      candidate,
      'dinodia_remote_manager',
      SERVICE_RESOLVE_BINDING,
      {
        remote_device_id: remoteDeviceId,
        remote_entity_id: remoteEntityId,
      },
      undefined,
      { returnResponse: true }
    );
    if (result && typeof result === 'object' && 'binding' in result) {
      const typed = result as ResolveBindingResponse;
      if (typed.binding || typed.capability) {
        return {
          binding: typed.binding ?? bindingHint,
          capability: typed.capability ?? null,
          resolutionState: typed.binding
            ? 'bound'
            : typed.capability
              ? 'target_unresolved'
              : bindingHint
                ? 'target_unresolved'
                : 'unresolved',
        };
      }
    }
  } catch {
    // fall through
  }

  try {
    const listResult = await callHaService(
      candidate,
      'dinodia_remote_manager',
      SERVICE_LIST_BINDINGS,
      {},
      undefined,
      { returnResponse: true }
    );
    const bindings = (listResult as ListBindingsResponse | null | undefined)?.bindings ?? [];
    const binding = findBindingForRemote(bindings, remoteDeviceId, remoteEntityId);
    if (!binding) {
      return {
        binding: bindingHint,
        capability: null,
        resolutionState: bindingHint ? 'target_unresolved' : 'unbound',
      };
    }

    const resolved = await callHaService(
      candidate,
      'dinodia_remote_manager',
      SERVICE_RESOLVE_BINDING,
      { binding_id: binding.bindingId },
      undefined,
      { returnResponse: true }
    );
    if (resolved && typeof resolved === 'object') {
      const typed = resolved as ResolveBindingResponse;
      if (typed.binding || typed.capability) {
        return {
          binding: typed.binding ?? binding,
          capability: typed.capability ?? null,
          resolutionState: typed.binding
            ? 'bound'
            : typed.capability
              ? 'target_unresolved'
              : 'target_unresolved',
        };
      }
    }
    return { binding, capability: null, resolutionState: 'target_unresolved' };
  } catch {
    return null;
  }
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

  const bindingInventory: RemoteDeviceSummary['binding'][] = [];
  for (const candidate of candidates) {
    try {
      const listResult = await callHaService(
        candidate,
        'dinodia_remote_manager',
        SERVICE_LIST_BINDINGS,
        {},
        undefined,
        { returnResponse: true }
      );
      const bindings = (listResult as ListBindingsResponse | null | undefined)?.bindings ?? [];
      if (bindings.length > 0) {
        bindingInventory.push(...bindings);
      }
    } catch {
      // continue
    }
  }

  if (remoteMetadata.length > 0 && bindingInventory.length === 0) {
    safeLog('warn', '[api/remote-devices] Remote devices found but no remote bindings returned', {
      remoteCount: remoteMetadata.length,
      candidateCount: candidates.length,
    });
  }

  const normalizedBindings = mergeBindingInventory(bindingInventory);

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

    const inventoryBinding = findBindingForRemote(
      normalizedBindings,
      remoteDeviceId,
      normalize(remote.entity_id) || null
    );
    let binding: RemoteDeviceSummary['binding'] = inventoryBinding;
    let capability: RemoteDeviceSummary['capability'] = null;
    let resolutionState: BindingResolutionState = inventoryBinding ? 'target_unresolved' : 'unbound';
    for (const candidate of candidates) {
      try {
        const result = await resolveRemoteBinding(
          candidate,
          remoteDeviceId,
          normalize(remote.entity_id) || null,
          binding
        );
        if (result?.binding || result?.capability) {
          binding = result.binding ?? null;
          capability = result.capability ?? null;
          resolutionState = result.resolutionState;
          break;
        }
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
      target: buildTargetSummary(allDevices, binding, capability),
      resolutionState,
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
