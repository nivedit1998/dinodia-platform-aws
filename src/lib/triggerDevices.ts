import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { REMOTE_LABEL } from '@/lib/deviceLabels';
import { getActionsForDevice } from '@/lib/deviceCapabilities';
import { safeLog } from '@/lib/safeLogger';
import {
  callHaService,
  getDeviceAutomationTriggersCached,
  getDeviceRegistryMetadata,
  getDevicesWithLabelMetadata,
  type HaConnectionLike,
  type HaDeviceAutomationTrigger,
  type HaDeviceRegistryMetadata,
} from '@/lib/homeAssistant';
import {
  REMOTE_BINDING_READ_TIMEOUT_MS,
  REMOTE_BINDING_UPDATE_TIMEOUT_MS,
  REMOTE_MANAGER_DOMAIN,
  SERVICE_LIST_BINDINGS,
  SERVICE_LIST_TRIGGER_DEVICES,
  SERVICE_REGISTER_BINDING,
  SERVICE_RESOLVE_BINDING,
  SERVICE_UPDATE_BINDING,
} from '@/lib/remoteManager';
import type {
  TriggerDeviceBindingSummary,
  TriggerDeviceCapabilitySummary,
  TriggerDeviceResolutionState,
  TriggerDeviceSummary,
  TriggerDeviceTargetSummary,
} from '@/types/triggerDevice';

function normalize(value: string | null | undefined) {
  return (value ?? '').toString().trim();
}

function normalizeIdentifier(value: string | null | undefined) {
  return normalize(value).toLowerCase();
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && /timeout|timed out|abort/i.test(error.message);
}

function buildHaCandidates(haConnection: {
  baseUrl: string;
  cloudUrl: string | null;
  longLivedToken: string;
}) {
  const candidates = new Set<string>();
  const ordered: Array<{ baseUrl: string; longLivedToken: string }> = [];
  for (const value of [haConnection.cloudUrl, haConnection.baseUrl]) {
    const normalized = normalize(value).replace(/\/+$/, '');
    if (!normalized || candidates.has(normalized)) continue;
    candidates.add(normalized);
    ordered.push({ baseUrl: normalized, longLivedToken: haConnection.longLivedToken });
  }
  return ordered;
}

function firstArea(device: { displayAreaName?: string | null; area?: string | null; areaName?: string | null }) {
  return normalize(device.displayAreaName ?? device.areaName ?? device.area) || null;
}

function compactServiceData(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
}

type DeviceSnapshot = Awaited<ReturnType<typeof getDevicesForHaConnection>>;
type DeviceSnapshotItem = DeviceSnapshot[number];

type ResolveBindingResponse = {
  binding?: TriggerDeviceBindingSummary | null;
  capability?: TriggerDeviceCapabilitySummary | null;
};

type ListBindingsResponse = {
  bindings?: TriggerDeviceBindingSummary[];
};

type TriggerDeviceInventoryItem = {
  device_id: string;
  name?: string | null;
  trigger_count?: number;
  triggers?: unknown[];
  entity_ids?: string[];
  has_actionable_target?: boolean;
  remote_label?: boolean;
  registry_remote_like?: boolean;
  integration_domains?: string[];
  manufacturer?: string | null;
  model?: string | null;
  reason?: string | null;
};

type TriggerDeviceInventoryResponse = {
  trigger_devices?: TriggerDeviceInventoryItem[];
};

type BindingResolution = {
  binding: TriggerDeviceBindingSummary | null;
  capability: TriggerDeviceCapabilitySummary | null;
  resolutionState: TriggerDeviceResolutionState;
};

function mergeBindingInventory(bindings: TriggerDeviceBindingSummary[]) {
  const seen = new Map<string, TriggerDeviceBindingSummary>();
  for (const binding of bindings) {
    if (!binding?.bindingId) continue;
    if (!seen.has(binding.bindingId)) seen.set(binding.bindingId, binding);
  }
  return [...seen.values()];
}

function findBindingForTriggerDevice(
  bindings: TriggerDeviceBindingSummary[],
  triggerDeviceId: string,
  triggerEntityId: string | null
) {
  const triggerDeviceKey = normalizeIdentifier(triggerDeviceId);
  const triggerEntityKey = normalizeIdentifier(triggerEntityId);
  return (
    bindings.find((item) => normalizeIdentifier(item?.remoteDeviceId) === triggerDeviceKey) ??
    bindings.find((item) => normalizeIdentifier(item?.bindingId) === triggerDeviceKey) ??
    (triggerEntityKey
      ? bindings.find((item) => normalizeIdentifier(item?.remoteDeviceId) === triggerEntityKey) ??
        bindings.find((item) => normalizeIdentifier(item?.bindingId) === triggerEntityKey)
      : null) ??
    null
  );
}

async function resolveBindingCapability(
  candidate: HaConnectionLike,
  binding: TriggerDeviceBindingSummary
): Promise<BindingResolution> {
  if (!binding?.bindingId) {
    return { binding: null, capability: null, resolutionState: 'unbound' };
  }

  try {
    const resolved = await callHaService(
      candidate,
      REMOTE_MANAGER_DOMAIN,
      SERVICE_RESOLVE_BINDING,
      { binding_id: binding.bindingId },
      REMOTE_BINDING_READ_TIMEOUT_MS,
      { returnResponse: true }
    );

    if (resolved && typeof resolved === 'object') {
      const typed = resolved as ResolveBindingResponse;
      if (typed.binding || typed.capability) {
        return {
          binding: typed.binding ?? binding,
          capability: typed.capability ?? null,
          resolutionState: typed.capability ? 'bound' : 'target_unresolved',
        };
      }
    }
  } catch {
    // Keep the proven binding and show unresolved target details.
  }

  return { binding, capability: null, resolutionState: 'target_unresolved' };
}

async function listBindingInventory(candidate: HaConnectionLike) {
  try {
    const listResult = await callHaService(
      candidate,
      REMOTE_MANAGER_DOMAIN,
      SERVICE_LIST_BINDINGS,
      {},
      REMOTE_BINDING_READ_TIMEOUT_MS,
      { returnResponse: true }
    );
    return (listResult as ListBindingsResponse | null | undefined)?.bindings ?? [];
  } catch {
    return [];
  }
}

async function listTriggerDeviceInventory(candidate: HaConnectionLike): Promise<TriggerDeviceInventoryItem[]> {
  try {
    const result = await callHaService(
      candidate,
      REMOTE_MANAGER_DOMAIN,
      SERVICE_LIST_TRIGGER_DEVICES,
      {},
      REMOTE_BINDING_READ_TIMEOUT_MS,
      { returnResponse: true }
    );
    const typed = result as TriggerDeviceInventoryResponse | null | undefined;
    return Array.isArray(typed?.trigger_devices) ? typed.trigger_devices : [];
  } catch (err) {
    safeLog('warn', '[triggerDevices] HA trigger inventory unavailable; falling back to local heuristics', {
      err,
    });
    return [];
  }
}

function targetIsAllowed(args: {
  target: DeviceSnapshotItem;
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

function triggerDeviceIsVisible(args: {
  triggerDeviceId: string;
  triggerAreaName: string | null;
  allDevices: DeviceSnapshot;
  ownTenantOwnedEntityIds: Set<string>;
  allTenantOwnedEntityIds: Set<string>;
  allowedAreas: Set<string>;
}) {
  const {
    triggerDeviceId,
    triggerAreaName,
    allDevices,
    ownTenantOwnedEntityIds,
    allTenantOwnedEntityIds,
    allowedAreas,
  } = args;
  const deviceMatches = allDevices.filter((device) => normalize(device.deviceId) === triggerDeviceId);
  if (deviceMatches.some((device) => ownTenantOwnedEntityIds.has(device.entityId))) return true;
  if (deviceMatches.some((device) => allTenantOwnedEntityIds.has(device.entityId))) return false;

  const representative = deviceMatches[0] ?? null;
  const areaName = normalize(triggerAreaName) || firstArea(representative ?? {}) || null;
  return Boolean(areaName && allowedAreas.has(areaName));
}

function buildUnavailableTargetSummary(): TriggerDeviceTargetSummary {
  return {
    targetId: 'unavailable',
    entityId: null,
    deviceId: null,
    name: 'Target unavailable',
    domain: 'unknown',
    areaName: null,
    label: null,
    labelCategory: null,
    state: 'unavailable',
  };
}

function buildTargetSummary(args: {
  devices: DeviceSnapshot;
  binding: TriggerDeviceBindingSummary | null;
  capability: TriggerDeviceCapabilitySummary | null;
  ownTenantOwnedEntityIds: Set<string>;
  allTenantOwnedEntityIds: Set<string>;
  allowedAreas: Set<string>;
}): { target: TriggerDeviceTargetSummary | null; unavailable: boolean } {
  const { devices, binding, capability, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, allowedAreas } = args;
  const entityId = normalize(capability?.targetEntityId || binding?.targetEntityId);
  const deviceId = normalize(capability?.targetDeviceId || binding?.targetDeviceId);

  const target =
    (entityId && devices.find((device) => normalize(device.entityId) === entityId)) ||
    (deviceId && devices.find((device) => normalize(device.deviceId) === deviceId)) ||
    null;

  if (target) {
    if (!targetIsAllowed({ target, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, allowedAreas })) {
      return { target: buildUnavailableTargetSummary(), unavailable: true };
    }
    return {
      unavailable: false,
      target: {
        targetId: entityId || deviceId || target.entityId,
        entityId: target.entityId,
        deviceId: target.deviceId ?? null,
        name: target.displayName ?? target.name,
        domain: target.domain,
        areaName: firstArea(target),
        label: target.displayLabel ?? target.label ?? null,
        labelCategory: target.canonicalLabel ?? target.labelCategory ?? null,
        state: target.state,
      },
    };
  }

  if (entityId || deviceId || binding || capability) {
    return {
      unavailable: false,
      target: {
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
      },
    };
  }

  return { target: null, unavailable: false };
}

function entityLooksDiagnosticOrTriggerOnly(device: DeviceSnapshotItem) {
  const domain = device.domain;
  const deviceClass = typeof device.attributes?.device_class === 'string' ? device.attributes.device_class : '';
  if (domain === 'button') return true;
  if (domain === 'sensor') return true;
  if (domain === 'binary_sensor') return true;
  if (domain === 'event') return true;
  if (deviceClass === 'identify') return true;
  if (deviceClass === 'battery') return true;
  return false;
}

function hasDashboardAction(device: DeviceSnapshotItem) {
  return getActionsForDevice(device, 'dashboard').length > 0;
}

function registryLooksRemoteLike(metadata: HaDeviceRegistryMetadata | null | undefined) {
  if (!metadata) return false;
  const haystack = [
    metadata.manufacturer,
    metadata.model,
    metadata.name,
    metadata.name_by_user,
    ...(metadata.identifiers ?? []).flat(),
    ...(metadata.integration_domains ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const hasRemoteWord = /\b(remote|dimmer|button|switch|shortcut|scene|dial|knob|rodret|styrbar|tradfri|symfonisk|hue tap|hue dimmer)\b/.test(haystack);
  const hasTriggerIntegration = /\b(zha|zigbee|matter|thread|homekit_controller)\b/.test(haystack);
  return hasRemoteWord && hasTriggerIntegration;
}

function isLikelyTriggerDevice(args: {
  entities: DeviceSnapshot;
  binding: TriggerDeviceBindingSummary | null;
  hasRemoteLabel: boolean;
  deviceTriggers: unknown[];
  inventoryItem: TriggerDeviceInventoryItem | null;
  registryMetadata: HaDeviceRegistryMetadata | null;
}) {
  if (args.binding) return true;
  if (args.entities.length === 0) return false;
  if (args.entities.some(hasDashboardAction)) return false;
  if ((args.inventoryItem?.trigger_count ?? 0) > 0) return true;
  if (args.deviceTriggers.length > 0) return true;
  if (registryLooksRemoteLike(args.registryMetadata)) return true;
  if (!args.hasRemoteLabel) return false;
  return args.entities.every(entityLooksDiagnosticOrTriggerOnly);
}

function getRepresentativeEntity(
  deviceMatches: DeviceSnapshot,
  fallbackEntityId: string | null,
  allDevices: DeviceSnapshot
) {
  return (
    deviceMatches.find((device) => device.domain !== 'sensor' && device.domain !== 'binary_sensor') ??
    deviceMatches[0] ??
    allDevices.find((device) => normalize(device.entityId) === normalize(fallbackEntityId)) ??
    null
  );
}

function labelsIncludeRemote(labels: string[] | null | undefined) {
  return (labels ?? []).some((label) => normalizeIdentifier(label) === normalizeIdentifier(REMOTE_LABEL));
}

function groupDevicesByDeviceId(devices: DeviceSnapshot) {
  const map = new Map<string, DeviceSnapshotItem[]>();
  for (const device of devices) {
    const deviceId = normalize(device.deviceId);
    if (!deviceId) continue;
    if (!map.has(deviceId)) map.set(deviceId, []);
    map.get(deviceId)!.push(device);
  }
  return map;
}

async function loadContext(userId: number, fresh: boolean) {
  const { user, haConnection } = await getUserWithHaConnection(userId);
  if (!user.homeId) throw new Error('Your home is not set up yet.');

  const allDevices = await getDevicesForHaConnection(haConnection.id, {
    bypassCache: fresh,
    labelsOnly: false,
    includeServicesForTarget: false,
  });
  const tenantOwnedForHome = await getTenantOwnedTargetsForHome(user.homeId, haConnection.id);
  const tenantOwnedForUser = await getTenantOwnedTargetsForUser(user.id, haConnection.id);

  return {
    user,
    haConnection,
    allDevices,
    candidates: buildHaCandidates(haConnection),
    allTenantOwnedEntityIds: new Set(tenantOwnedForHome.entityIds),
    ownTenantOwnedEntityIds: new Set(tenantOwnedForUser.entityIds),
    allowedAreas: new Set((user.accessRules ?? []).map((rule) => rule.area)),
  };
}

async function chooseCandidateForUpdate(candidates: HaConnectionLike[]) {
  return candidates;
}

export async function getTriggerDevicesForTenant(args: {
  userId: number;
  fresh?: boolean;
}): Promise<TriggerDeviceSummary[]> {
  const {
    allDevices,
    candidates,
    allTenantOwnedEntityIds,
    ownTenantOwnedEntityIds,
    allowedAreas,
  } = await loadContext(args.userId, args.fresh === true);

  const entitiesByDeviceId = groupDevicesByDeviceId(allDevices);
  const bindingInventory: TriggerDeviceBindingSummary[] = [];
  const triggerInventory: TriggerDeviceInventoryItem[] = [];
  let remoteMetadata: Awaited<ReturnType<typeof getDevicesWithLabelMetadata>> = [];
  let registryMetadata: HaDeviceRegistryMetadata[] = [];

  for (const candidate of candidates) {
    const bindings = await listBindingInventory(candidate);
    if (bindings.length > 0) bindingInventory.push(...bindings);
  }

  for (const candidate of candidates) {
    const inventory = await listTriggerDeviceInventory(candidate);
    if (inventory.length > 0) triggerInventory.push(...inventory);
  }

  for (const candidate of candidates) {
    try {
      const metadata = await getDevicesWithLabelMetadata(candidate, REMOTE_LABEL);
      if (metadata.length > 0) {
        remoteMetadata = metadata;
        break;
      }
    } catch {
      remoteMetadata = [];
    }
  }

  for (const candidate of candidates) {
    try {
      registryMetadata = await getDeviceRegistryMetadata(candidate);
      if (registryMetadata.length > 0) break;
    } catch (err) {
      safeLog('warn', '[triggerDevices] Device registry metadata unavailable', { err });
      registryMetadata = [];
    }
  }

  const normalizedBindings = mergeBindingInventory(bindingInventory);
  const inventoryByDeviceId = new Map(
    triggerInventory
      .filter((item) => normalize(item.device_id))
      .map((item) => [normalize(item.device_id), item])
  );
  const remoteMetaByDeviceId = new Map(
    remoteMetadata
      .filter((item) => normalize(item.device_id))
      .map((item) => [normalize(item.device_id), item])
  );
  const registryByDeviceId = new Map(
    registryMetadata
      .filter((item) => normalize(item.id))
      .map((item) => [normalize(item.id), item])
  );

  const candidateDeviceIds = new Set<string>();
  for (const binding of normalizedBindings) candidateDeviceIds.add(normalize(binding.remoteDeviceId));
  for (const item of triggerInventory) candidateDeviceIds.add(normalize(item.device_id));
  for (const remote of remoteMetadata) candidateDeviceIds.add(normalize(remote.device_id));
  for (const metadata of registryMetadata) {
    if (registryLooksRemoteLike(metadata)) candidateDeviceIds.add(metadata.id);
  }
  for (const [deviceId, entities] of entitiesByDeviceId) {
    if (entities.length > 0 && !entities.some(hasDashboardAction)) candidateDeviceIds.add(deviceId);
  }
  candidateDeviceIds.delete('');

  const summaries: TriggerDeviceSummary[] = [];
  for (const triggerDeviceId of candidateDeviceIds) {
    const deviceMatches = entitiesByDeviceId.get(triggerDeviceId) ?? [];
    const remoteMeta = remoteMetaByDeviceId.get(triggerDeviceId) ?? null;
    const representative = getRepresentativeEntity(deviceMatches, remoteMeta?.entity_id ?? null, allDevices);
    const inventoryItem = inventoryByDeviceId.get(triggerDeviceId) ?? null;
    const registryItem = registryByDeviceId.get(triggerDeviceId) ?? null;
    const binding = findBindingForTriggerDevice(
      normalizedBindings,
      triggerDeviceId,
      normalize(remoteMeta?.entity_id) || representative?.entityId || null
    );
    const hasRemoteLabel =
      labelsIncludeRemote(remoteMeta?.labels) ||
      labelsIncludeRemote(registryItem?.labels) ||
      deviceMatches.some((device) => labelsIncludeRemote(device.labels));

    let deviceTriggers: HaDeviceAutomationTrigger[] = [];
    if (!binding && !((inventoryItem?.trigger_count ?? 0) > 0)) {
      for (const candidate of candidates) {
        deviceTriggers = await getDeviceAutomationTriggersCached(candidate, triggerDeviceId);
        if (deviceTriggers.length > 0) break;
      }
    }

    if (
      !isLikelyTriggerDevice({
        entities: deviceMatches,
        binding,
        hasRemoteLabel,
        deviceTriggers,
        inventoryItem,
        registryMetadata: registryItem,
      })
    ) {
      continue;
    }

    const triggerAreaName =
      firstArea(representative ?? {}) || normalize(remoteMeta?.area_name) || null;
    if (
      !triggerDeviceIsVisible({
        triggerDeviceId,
        triggerAreaName,
        allDevices,
        ownTenantOwnedEntityIds,
        allTenantOwnedEntityIds,
        allowedAreas,
      })
    ) {
      continue;
    }

    let resolvedBinding = binding;
    let capability: TriggerDeviceCapabilitySummary | null = null;
    let resolutionState: TriggerDeviceResolutionState = binding ? 'target_unresolved' : 'unbound';

    if (binding) {
      for (const candidate of candidates) {
        const result = await resolveBindingCapability(candidate, binding);
        resolvedBinding = result.binding;
        capability = result.capability;
        resolutionState = result.resolutionState;
        if (result.binding || result.capability) break;
      }
    }

    const targetResult = buildTargetSummary({
      devices: allDevices,
      binding: resolvedBinding,
      capability,
      ownTenantOwnedEntityIds,
      allTenantOwnedEntityIds,
      allowedAreas,
    });
    if (targetResult.unavailable) resolutionState = 'target_unavailable';

    const visualLabel =
      representative?.displayLabel ||
      representative?.label ||
      remoteMeta?.labels?.find((label) => normalize(label)) ||
      registryItem?.labels?.find((label) => normalize(label)) ||
      REMOTE_LABEL;
    const labels = representative?.labels?.length
      ? representative.labels
      : remoteMeta?.labels?.length
        ? remoteMeta.labels
        : registryItem?.labels?.length
          ? registryItem.labels.filter((label): label is string => typeof label === 'string')
          : [visualLabel];

    summaries.push({
      triggerDeviceId,
      entityId: normalize(remoteMeta?.entity_id) || representative?.entityId || triggerDeviceId,
      deviceId: triggerDeviceId,
      name:
        remoteMeta?.name ||
        representative?.displayName ||
        representative?.name ||
        registryItem?.name_by_user ||
        registryItem?.name ||
        inventoryItem?.name ||
        triggerDeviceId,
      state: representative?.state ?? 'unknown',
      area: triggerAreaName,
      areaName: triggerAreaName,
      label: visualLabel,
      labelCategory: representative?.canonicalLabel ?? representative?.labelCategory ?? visualLabel,
      labels,
      domain: representative?.domain ?? 'remote',
      attributes: representative?.attributes ?? {},
      isTriggerDevice: true,
      binding: resolvedBinding,
      capability,
      target: targetResult.target,
      resolutionState,
    });
  }

  summaries.sort((left, right) => {
    const leftArea = normalize(left.areaName ?? left.area);
    const rightArea = normalize(right.areaName ?? right.area);
    if (leftArea !== rightArea) return leftArea.localeCompare(rightArea);
    const leftLabel = normalize(left.label);
    const rightLabel = normalize(right.label);
    if (leftLabel !== rightLabel) return leftLabel.localeCompare(rightLabel);
    return left.name.localeCompare(right.name);
  });

  return summaries;
}

export async function saveTriggerDeviceTarget(args: {
  userId: number;
  triggerDeviceId: string;
  bindingId?: string | null;
  targetDeviceId?: string | null;
  targetEntityId?: string | null;
  bindingName?: string | null;
}): Promise<{
  binding?: TriggerDeviceBindingSummary | null;
  capability?: TriggerDeviceCapabilitySummary | null;
  ok?: true;
}> {
  const triggerDeviceId = normalize(args.triggerDeviceId);
  const bindingId = normalize(args.bindingId) || null;
  const targetDeviceId = normalize(args.targetDeviceId) || null;
  const targetEntityId = normalize(args.targetEntityId) || null;
  const bindingName = normalize(args.bindingName) || null;

  if (!triggerDeviceId) throw new Error('Trigger device is required.');
  if (!targetDeviceId && !targetEntityId) throw new Error('Choose a target device or entity.');
  if (targetDeviceId && targetDeviceId === triggerDeviceId) {
    throw new Error('Trigger device and target cannot be the same device.');
  }

  const {
    user,
    allDevices,
    candidates,
    allTenantOwnedEntityIds,
    ownTenantOwnedEntityIds,
    allowedAreas,
  } = await loadContext(args.userId, true);

  const triggerMatches = allDevices.filter((device) => normalize(device.deviceId) === triggerDeviceId);
  const triggerAreaName = firstArea(triggerMatches[0] ?? {}) || null;
  if (
    !triggerDeviceIsVisible({
      triggerDeviceId,
      triggerAreaName,
      allDevices,
      ownTenantOwnedEntityIds,
      allTenantOwnedEntityIds,
      allowedAreas,
    })
  ) {
    throw new Error('Trigger device is not available.');
  }

  const target =
    (targetEntityId && allDevices.find((device) => device.entityId === targetEntityId)) ||
    (targetDeviceId && allDevices.find((device) => normalize(device.deviceId) === targetDeviceId)) ||
    null;
  if (!target) throw new Error('Target is not available.');
  if (!targetIsAllowed({ target, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, allowedAreas })) {
    throw new Error('Target is not available.');
  }

  let lastError: unknown = null;
  for (const candidate of await chooseCandidateForUpdate(candidates)) {
    try {
      const service = bindingId ? SERVICE_UPDATE_BINDING : SERVICE_REGISTER_BINDING;
      const result = await callHaService(
        candidate,
        REMOTE_MANAGER_DOMAIN,
        service,
        compactServiceData({
          binding_id: bindingId,
          remote_device_id: triggerDeviceId,
          target_device_id: targetDeviceId || target.deviceId,
          target_entity_id: targetEntityId || target.entityId,
          binding_name: bindingName || `${triggerMatches[0]?.name || triggerDeviceId} control`,
        }),
        REMOTE_BINDING_UPDATE_TIMEOUT_MS,
        { returnResponse: true }
      );
      return (result as { binding?: TriggerDeviceBindingSummary | null; capability?: TriggerDeviceCapabilitySummary | null }) ?? { ok: true };
    } catch (err) {
      lastError = err;
    }
  }

  safeLog('error', '[triggerDevices] Failed to save trigger-device target', {
    userId: user.id,
    triggerDeviceId,
    targetEntityId,
    targetDeviceId,
    error: lastError,
  });

  if (isTimeoutError(lastError)) {
    throw new Error('Trigger target update is taking longer than expected. Refresh the dashboard and check the current target.');
  }
  throw new Error('Dinodia Hub did not respond when updating this trigger device.');
}
