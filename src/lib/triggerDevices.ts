import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { resolveDeviceDisplayBatch } from '@/lib/deviceDisplayResolver';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { getActionsForDevice } from '@/lib/deviceCapabilities';
import { isBlockingButtonActionEntity, isIgnoredDashboardHelperEntity } from '@/lib/dashboardEntityFilters';
import { buildAreaAccessMatcher } from '@/lib/areaAccess';
import { safeLog } from '@/lib/safeLogger';
import {
  callHaService,
  getDeviceRegistryMetadata,
  type HaConnectionLike,
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

function normalizeLabelList(labels: Array<string | null | undefined> | null | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels ?? []) {
    const cleaned = normalize(label);
    if (!cleaned) continue;
    const key = normalizeIdentifier(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
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
  labels?: string[];
  has_labels?: boolean;
  trigger_count?: number;
  triggers?: unknown[];
  trigger_sources?: string[];
  ha_python_trigger_count?: number;
  ha_ws_equivalent_trigger_count?: number;
  zha_quirk_trigger_count?: number;
  integration_trigger_count?: number;
  zha_quirk_class?: string | null;
  zha_ieee?: string | null;
  trigger_discovery_errors?: string[];
  entity_ids?: string[];
  has_actionable_target?: boolean;
  registry_remote_like?: boolean;
  diagnostic_only?: boolean;
  trigger_required?: boolean;
  integration_domains?: string[];
  manufacturer?: string | null;
  model?: string | null;
  reason?: string | null;
  real_action_entity_ids?: string[];
  blocking_button_entity_ids?: string[];
  ignored_helper_entity_ids?: string[];
  trigger_classification?: string;
};

type TriggerDeviceInventoryResponse = {
  trigger_devices?: TriggerDeviceInventoryItem[];
};

const TRIGGER_DEVICE_INVENTORY_CACHE_TTL_MS = 15_000;

type TriggerInventoryCacheEntry = {
  expiresAt: number;
  items: TriggerDeviceInventoryItem[];
  inFlight?: Promise<TriggerDeviceInventoryItem[]>;
};

const triggerInventoryCache = new Map<string, TriggerInventoryCacheEntry>();

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
    safeLog('warn', '[triggerDevices] HA trigger inventory unavailable; hiding trigger-device tiles', {
      err,
    });
    return [];
  }
}

function triggerInventoryCacheKey(candidate: HaConnectionLike) {
  return normalize(candidate.baseUrl).replace(/\/+$/, '').toLowerCase();
}

async function getCachedTriggerDeviceInventory(
  candidate: HaConnectionLike,
  options: { force?: boolean } = {}
): Promise<TriggerDeviceInventoryItem[]> {
  const key = triggerInventoryCacheKey(candidate);
  const now = Date.now();
  const cached = triggerInventoryCache.get(key);

  if (!options.force && cached?.items && cached.expiresAt > now) {
    return cached.items;
  }

  if (!options.force && cached?.inFlight) {
    return cached.inFlight;
  }

  const inFlight = listTriggerDeviceInventory(candidate)
    .then((items) => {
      triggerInventoryCache.set(key, {
        items,
        expiresAt: Date.now() + TRIGGER_DEVICE_INVENTORY_CACHE_TTL_MS,
      });
      return items;
    })
    .catch((err) => {
      safeLog('warn', '[triggerDevices] cached trigger inventory refresh failed', { err });
      const fallbackItems = cached?.items ?? [];
      triggerInventoryCache.set(key, {
        items: fallbackItems,
        expiresAt: Date.now() + Math.min(TRIGGER_DEVICE_INVENTORY_CACHE_TTL_MS, 5_000),
      });
      return fallbackItems;
    });

  triggerInventoryCache.set(key, {
    items: cached?.items ?? [],
    expiresAt: cached?.expiresAt ?? 0,
    inFlight,
  });

  return inFlight;
}

function triggerDeviceIsVisible(args: {
  triggerDeviceId: string;
  triggerAreaName: string | null;
  allDevices: DeviceSnapshot;
  ownTenantOwnedEntityIds: Set<string>;
  allTenantOwnedEntityIds: Set<string>;
  hasAreaAccess: (area: string | null | undefined) => boolean;
}) {
  const {
    triggerDeviceId,
    triggerAreaName,
    allDevices,
    ownTenantOwnedEntityIds,
    allTenantOwnedEntityIds,
    hasAreaAccess,
  } = args;
  const deviceMatches = allDevices.filter((device) => normalize(device.deviceId) === triggerDeviceId);
  if (deviceMatches.some((device) => ownTenantOwnedEntityIds.has(device.entityId))) return true;
  if (deviceMatches.some((device) => allTenantOwnedEntityIds.has(device.entityId))) return false;

  const representative = deviceMatches[0] ?? null;
  const areaName = normalize(triggerAreaName) || firstArea(representative ?? {}) || null;
  return hasAreaAccess(areaName);
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

function getDeviceGroup(devices: DeviceSnapshot, deviceId: string | null, entityId: string | null) {
  const normalizedDeviceId = normalize(deviceId);
  const normalizedEntityId = normalize(entityId);

  if (normalizedDeviceId) {
    const group = devices.filter((device) => normalize(device.deviceId) === normalizedDeviceId);
    if (group.length > 0) return group;
  }

  if (normalizedEntityId) {
    const matched = devices.find((device) => normalize(device.entityId) === normalizedEntityId);
    if (matched?.deviceId) {
      const group = devices.filter((device) => normalize(device.deviceId) === normalize(matched.deviceId));
      if (group.length > 0) return group;
    }
    if (matched) return [matched];
  }

  return [];
}

function hasExplicitTargetLabel(device: DeviceSnapshotItem) {
  return Boolean(
    normalize(device.sourceTechnicalLabel) ||
      (device.technicalLabels ?? device.labels ?? []).some((label) => normalize(label))
  );
}

function targetGroupHasEligibleLabel(group: DeviceSnapshot) {
  return group.some((device) => hasExplicitTargetLabel(device));
}

function chooseDisplayTargetEntity(group: DeviceSnapshot) {
  return (
    group.find((device) => hasRealDashboardAction(device) && !isIgnoredDashboardHelperEntity(device)) ??
    group.find((device) => !isIgnoredDashboardHelperEntity(device)) ??
    group[0] ??
    null
  );
}

function chooseControllableTargetEntity(group: DeviceSnapshot, preferredEntityId: string | null) {
  const preferred = preferredEntityId
    ? group.find((device) => normalize(device.entityId) === normalize(preferredEntityId))
    : null;

  if (preferred && hasRealDashboardAction(preferred) && !isIgnoredDashboardHelperEntity(preferred)) {
    return preferred;
  }

  return (
    group.find(
      (device) =>
        hasExplicitTargetLabel(device) &&
        hasRealDashboardAction(device) &&
        !isIgnoredDashboardHelperEntity(device)
    ) ??
    group.find((device) => hasRealDashboardAction(device) && !isIgnoredDashboardHelperEntity(device)) ??
    null
  );
}

function chooseTargetDisplayName(group: DeviceSnapshot, representative: DeviceSnapshotItem | null) {
  const controllableWithDisplayName = group.find(
    (device) => hasRealDashboardAction(device) && normalize(device.displayName)
  );
  if (controllableWithDisplayName?.displayName) return controllableWithDisplayName.displayName;

  const controllableWithName = group.find((device) => hasRealDashboardAction(device) && normalize(device.name));
  if (controllableWithName) return controllableWithName.displayName ?? controllableWithName.name;

  const nonHelperWithDisplayName = group.find(
    (device) => !isIgnoredDashboardHelperEntity(device) && normalize(device.displayName)
  );
  if (nonHelperWithDisplayName?.displayName) return nonHelperWithDisplayName.displayName;

  const nonHelperWithName = group.find((device) => !isIgnoredDashboardHelperEntity(device) && normalize(device.name));
  if (nonHelperWithName) return nonHelperWithName.displayName ?? nonHelperWithName.name;

  if (representative) return representative.displayName ?? representative.name;
  return 'Target unavailable';
}

function targetGroupIsAllowed(args: {
  group: DeviceSnapshot;
  ownTenantOwnedEntityIds: Set<string>;
  allTenantOwnedEntityIds: Set<string>;
  hasAreaAccess: (area: string | null | undefined) => boolean;
}) {
  const { group, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, hasAreaAccess } = args;
  if (!targetGroupHasEligibleLabel(group)) return false;
  if (group.some((device) => ownTenantOwnedEntityIds.has(device.entityId))) return true;
  if (group.every((device) => allTenantOwnedEntityIds.has(device.entityId))) return false;

  return group.some((device) => {
    if (allTenantOwnedEntityIds.has(device.entityId)) return false;
    const areaName = firstArea(device);
    return hasAreaAccess(areaName);
  });
}

function buildTargetSummary(args: {
  devices: DeviceSnapshot;
  binding: TriggerDeviceBindingSummary | null;
  capability: TriggerDeviceCapabilitySummary | null;
  ownTenantOwnedEntityIds: Set<string>;
  allTenantOwnedEntityIds: Set<string>;
  hasAreaAccess: (area: string | null | undefined) => boolean;
}): { target: TriggerDeviceTargetSummary | null; unavailable: boolean } {
  const { devices, binding, capability, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, hasAreaAccess } = args;
  const entityId = normalize(capability?.targetEntityId || binding?.targetEntityId);
  const deviceId = normalize(capability?.targetDeviceId || binding?.targetDeviceId);

  const targetGroup = getDeviceGroup(devices, deviceId || null, entityId || null);
  const target = chooseControllableTargetEntity(targetGroup, entityId || null) ?? chooseDisplayTargetEntity(targetGroup);

  if (targetGroup.length > 0 && target) {
    if (!targetGroupIsAllowed({ group: targetGroup, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, hasAreaAccess })) {
      return { target: buildUnavailableTargetSummary(), unavailable: true };
    }
    return {
      unavailable: false,
      target: {
        targetId: deviceId || target.deviceId || entityId || target.entityId,
        entityId: target.entityId,
        deviceId: (target.deviceId ?? deviceId) || null,
        name: chooseTargetDisplayName(targetGroup, target),
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

const REAL_DASHBOARD_ACTION_DOMAINS = new Set([
  'light',
  'switch',
  'climate',
  'cover',
  'media_player',
  'fan',
  'lock',
  'humidifier',
  'vacuum',
]);

function hasRealDashboardAction(device: DeviceSnapshotItem) {
  if (isIgnoredDashboardHelperEntity(device)) return false;

  const domain = (device.domain || '').toLowerCase();
  if (!REAL_DASHBOARD_ACTION_DOMAINS.has(domain)) return false;

  return getActionsForDevice(device).length > 0;
}

function isRemoteManagerAcceptedTriggerDevice(args: {
  inventoryItem: TriggerDeviceInventoryItem | null;
}) {
  return (args.inventoryItem?.trigger_count ?? 0) > 0;
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

function getEffectiveHaLabels(args: {
  deviceMatches: DeviceSnapshot;
  inventoryItem: TriggerDeviceInventoryItem | null;
  registryItem: HaDeviceRegistryMetadata | null;
}) {
  return normalizeLabelList([
    ...args.deviceMatches.flatMap((device) => device.technicalLabels ?? device.labels ?? []),
    ...args.deviceMatches.map((device) => device.sourceTechnicalLabel),
    ...(args.inventoryItem?.labels ?? []),
    ...(args.registryItem?.labels ?? []),
  ]);
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

  const allDevicesRaw = await getDevicesForHaConnection(haConnection.id, {
    bypassCache: fresh,
    labelsOnly: false,
    includeServicesForTarget: false,
  });
  const allDevices = await resolveDeviceDisplayBatch(allDevicesRaw, {
    viewer: 'tenant',
    userId: user.id,
    homeId: user.homeId,
    haConnectionId: haConnection.id,
  });
  const tenantOwnedForHome = await getTenantOwnedTargetsForHome(user.homeId, haConnection.id);
  const tenantOwnedForUser = await getTenantOwnedTargetsForUser(user.id, haConnection.id);
  const areaAccess = await buildAreaAccessMatcher({
    haConnectionId: haConnection.id,
    accessAreas: (user.accessRules ?? []).map((rule) => rule.area),
  });

  return {
    user,
    haConnection,
    allDevices,
    candidates: buildHaCandidates(haConnection),
    allTenantOwnedEntityIds: new Set(tenantOwnedForHome.entityIds),
    ownTenantOwnedEntityIds: new Set(tenantOwnedForUser.entityIds),
    hasAreaAccess: areaAccess.hasAreaAccess,
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
    hasAreaAccess,
  } = await loadContext(args.userId, args.fresh === true);

  const entitiesByDeviceId = groupDevicesByDeviceId(allDevices);
  const bindingInventory: TriggerDeviceBindingSummary[] = [];
  const triggerInventory: TriggerDeviceInventoryItem[] = [];
  let registryMetadata: HaDeviceRegistryMetadata[] = [];

  for (const candidate of candidates) {
    const bindings = await listBindingInventory(candidate);
    if (bindings.length > 0) bindingInventory.push(...bindings);
  }

  for (const candidate of candidates) {
    const inventory = await getCachedTriggerDeviceInventory(candidate, { force: args.fresh === true });
    if (inventory.length > 0) triggerInventory.push(...inventory);
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
  const registryByDeviceId = new Map(
    registryMetadata
      .filter((item) => normalize(item.id))
      .map((item) => [normalize(item.id), item])
  );

  const candidateDeviceIds = new Set(
    triggerInventory
      .filter((item) => normalize(item.device_id))
      .filter((item) => (item.trigger_count ?? 0) > 0)
      .map((item) => normalize(item.device_id))
  );
  for (const binding of normalizedBindings) {
    const remoteDeviceId = normalize(binding.remoteDeviceId);
    if (remoteDeviceId && !candidateDeviceIds.has(remoteDeviceId)) {
      safeLog('warn', '[triggerDevices] hiding binding because Remote Manager did not accept trigger device', {
        remoteDeviceIdHash: remoteDeviceId.slice(0, 8),
        bindingId: binding.bindingId,
      });
    }
  }

  const summaries: TriggerDeviceSummary[] = [];
  for (const triggerDeviceId of candidateDeviceIds) {
    const deviceMatches = entitiesByDeviceId.get(triggerDeviceId) ?? [];
    const representative = getRepresentativeEntity(deviceMatches, null, allDevices);
    const inventoryItem = inventoryByDeviceId.get(triggerDeviceId) ?? null;
    const registryItem = registryByDeviceId.get(triggerDeviceId) ?? null;
    const binding = findBindingForTriggerDevice(
      normalizedBindings,
      triggerDeviceId,
      representative?.entityId || null
    );
    const effectiveHaLabels = getEffectiveHaLabels({ deviceMatches, inventoryItem, registryItem });

    if (effectiveHaLabels.length === 0) {
      if (binding) {
        safeLog('warn', '[triggerDevices] hiding bound trigger-device without HA labels', {
          triggerDeviceIdHash: triggerDeviceId.slice(0, 8),
        });
      }
      continue;
    }
    const realActionEntities = deviceMatches.filter(hasRealDashboardAction);
    const blockingButtonEntities = deviceMatches.filter(isBlockingButtonActionEntity);
    const ignoredHelperEntities = deviceMatches.filter(isIgnoredDashboardHelperEntity);
    if (realActionEntities.length > 0 || blockingButtonEntities.length > 0) continue;

    if (!isRemoteManagerAcceptedTriggerDevice({ inventoryItem })) {
      continue;
    }

    const triggerAreaName = firstArea(representative ?? {}) || null;
    if (
      !triggerDeviceIsVisible({
        triggerDeviceId,
        triggerAreaName,
        allDevices,
        ownTenantOwnedEntityIds,
        allTenantOwnedEntityIds,
        hasAreaAccess,
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
      hasAreaAccess,
    });
    if (targetResult.unavailable) resolutionState = 'target_unavailable';

    const visualLabel =
      normalize(representative?.displayLabel) ||
      effectiveHaLabels.find((label) => normalizeIdentifier(label) !== 'tenant_device') ||
      effectiveHaLabels[0] ||
      'Trigger';
    const labels = effectiveHaLabels.length > 0 ? effectiveHaLabels : [visualLabel];
    const displayName =
      representative?.displayName ||
      representative?.name ||
      registryItem?.name_by_user ||
      registryItem?.name ||
      inventoryItem?.name ||
      triggerDeviceId;

    summaries.push({
      triggerDeviceId,
      entityId: representative?.entityId || triggerDeviceId,
      deviceId: triggerDeviceId,
      name: displayName,
      state: representative?.state ?? 'unknown',
      area: triggerAreaName,
      areaName: triggerAreaName,
      label: visualLabel,
      labelCategory: representative?.canonicalLabel ?? representative?.labelCategory ?? visualLabel,
      displayName,
      displayAreaName: triggerAreaName,
      displayLabel: visualLabel,
      sourceTechnicalLabel: representative?.sourceTechnicalLabel ?? effectiveHaLabels[0] ?? null,
      labels,
      domain: representative?.domain ?? 'remote',
      attributes: representative?.attributes ?? {},
      isTriggerDevice: true,
      binding: resolvedBinding,
      capability,
      target: targetResult.target,
      resolutionState,
      realActionEntityIds: inventoryItem?.real_action_entity_ids ?? realActionEntities.map((entity) => entity.entityId),
      blockingButtonEntityIds:
        inventoryItem?.blocking_button_entity_ids ?? blockingButtonEntities.map((entity) => entity.entityId),
      ignoredHelperEntityIds:
        inventoryItem?.ignored_helper_entity_ids ?? ignoredHelperEntities.map((entity) => entity.entityId),
      triggerClassification: inventoryItem?.trigger_classification ?? 'remote_manager_accepted',
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
    hasAreaAccess,
  } = await loadContext(args.userId, true);

  const triggerInventory: TriggerDeviceInventoryItem[] = [];
  for (const candidate of candidates) {
    const inventory = await getCachedTriggerDeviceInventory(candidate, { force: false });
    if (inventory.length > 0) triggerInventory.push(...inventory);
  }
  const acceptedTriggerIds = new Set(
    triggerInventory
      .filter((item) => (item.trigger_count ?? 0) > 0)
      .map((item) => normalize(item.device_id))
      .filter(Boolean)
  );
  if (!acceptedTriggerIds.has(triggerDeviceId)) {
    throw new Error('Trigger device is not available.');
  }

  const triggerMatches = allDevices.filter((device) => normalize(device.deviceId) === triggerDeviceId);
  const triggerAreaName = firstArea(triggerMatches[0] ?? {}) || null;
  if (
    !triggerDeviceIsVisible({
      triggerDeviceId,
      triggerAreaName,
      allDevices,
      ownTenantOwnedEntityIds,
      allTenantOwnedEntityIds,
      hasAreaAccess,
    })
  ) {
    throw new Error('Trigger device is not available.');
  }

  const targetGroup = getDeviceGroup(allDevices, targetDeviceId, targetEntityId);
  const target = chooseControllableTargetEntity(targetGroup, targetEntityId);
  if (!target) throw new Error('Target is not available.');
  const resolvedTargetDeviceId = normalize(targetDeviceId || target.deviceId);
  if (resolvedTargetDeviceId && resolvedTargetDeviceId === triggerDeviceId) {
    throw new Error('Trigger device and target cannot be the same device.');
  }
  if (isIgnoredDashboardHelperEntity(target) || isBlockingButtonActionEntity(target)) {
    throw new Error('Choose a controllable target device. Diagnostic buttons cannot be selected.');
  }
  if (!hasRealDashboardAction(target)) {
    throw new Error('Choose a controllable target device.');
  }
  if (
    targetGroup.length === 0 ||
    !targetGroupIsAllowed({ group: targetGroup, ownTenantOwnedEntityIds, allTenantOwnedEntityIds, hasAreaAccess })
  ) {
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
          target_device_id: resolvedTargetDeviceId || target.deviceId,
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
