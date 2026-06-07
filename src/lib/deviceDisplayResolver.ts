import { TenantDeviceCleanupStatus } from '@prisma/client';
import { normalizeLookupKey, stripTenantHaTechnicalPrefix } from '@/lib/displayNormalization';
import { getTenantOwnershipIndexForHome } from '@/lib/tenantOwnership';
import { prisma } from '@/lib/prisma';
import type { UIDevice } from '@/types/device';

export type DeviceDisplayContext =
  | { viewer: 'tenant'; userId: number; homeId: number; haConnectionId: number }
  | { viewer: 'homeowner'; userId: number; homeId: number; haConnectionId: number }
  | { viewer: 'alexa_tenant'; userId: number; homeId: number; haConnectionId: number }
  | { viewer: 'alexa_homeowner'; userId: number; homeId: number; haConnectionId: number };

function firstLabel(device: UIDevice) {
  return (device.technicalLabels ?? device.labels ?? [])
    .map((label) => label.trim())
    .find(Boolean);
}

function fallbackEntityDisplayName(entityId: string) {
  const objectId = entityId.includes('.') ? entityId.split('.').slice(1).join('.') : entityId;
  return objectId
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function inferCanonicalLabel(device: UIDevice): string {
  const domain = device.domain || device.entityId.split('.')[0] || '';
  const friendlyName =
    typeof device.attributes?.friendly_name === 'string' ? device.attributes.friendly_name : '';
  const hints = [
    device.entityId,
    device.name,
    friendlyName,
    device.label,
    device.labelCategory,
    ...(device.technicalLabels ?? device.labels ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (domain === 'cover') return 'Blind';
  if (domain === 'light') return 'Light';
  if (domain === 'switch') {
    if (hints.includes('kettle')) return 'Kettle';
    if (hints.includes('boiler')) return 'Boiler';
    if (hints.includes('light') || hints.includes('lamp') || hints.includes('spotlight')) return 'Light';
    return 'Switch';
  }
  if (domain === 'climate') {
    if (hints.includes('boiler')) return 'Boiler';
    if (hints.includes('radiator')) return 'Radiator';
    return 'Thermostat';
  }
  if (domain === 'media_player') {
    if (hints.includes('tv')) return 'TV';
    if (hints.includes('spotify')) return 'Spotify';
    return 'Speaker';
  }
  if (domain === 'binary_sensor') {
    if (hints.includes('motion') || hints.includes('occupancy')) return 'Motion Sensor';
    return 'Sensor';
  }
  if (domain === 'sensor') return 'Sensor';
  if (domain === 'button') return 'Button';
  return device.labelCategory || firstLabel(device) || domain || 'Other';
}

export async function resolveDeviceDisplayBatch(
  devices: UIDevice[],
  context: DeviceDisplayContext
): Promise<UIDevice[]> {
  if (devices.length === 0) return devices;

  const [deviceOverrides, areaOverrides, labelOverrides, tenantOverrides, ownershipIndex] =
    await Promise.all([
      prisma.device.findMany({
        where: { haConnectionId: context.haConnectionId },
        select: { entityId: true, name: true, area: true, label: true, blindTravelSeconds: true },
      }),
      prisma.areaDisplayOverride.findMany({
        where: { haConnectionId: context.haConnectionId },
      }),
      prisma.labelDisplayOverride.findMany({
        where: { haConnectionId: context.haConnectionId },
      }),
      prisma.tenantDeviceDisplayOverride.findMany({
        where: { haConnectionId: context.haConnectionId },
        include: { tenantVirtualArea: true },
      }),
      getTenantOwnershipIndexForHome({
        homeId: context.homeId,
        haConnectionId: context.haConnectionId,
        currentTenantUserId:
          context.viewer === 'tenant' || context.viewer === 'alexa_tenant'
            ? context.userId
            : undefined,
      }),
    ]);

  const deviceOverrideMap = new Map(deviceOverrides.map((override) => [override.entityId, override]));
  const areaOverrideMap = new Map(
    areaOverrides.map((override) => [override.haAreaName, override])
  );
  const labelOverrideMap = new Map(
    labelOverrides.map((override) => [normalizeLookupKey(override.sourceTechnicalLabel), override])
  );
  const tenantOverrideByDevice = new Map(
    tenantOverrides
      .filter((override) => override.haDeviceId)
      .map((override) => [override.haDeviceId!, override])
  );
  const tenantOverrideByEntity = new Map(
    tenantOverrides
      .filter((override) => override.entityId)
      .map((override) => [override.entityId!, override])
  );

  return devices.map((device) => {
    const tenantOverride =
      (device.deviceId ? tenantOverrideByDevice.get(device.deviceId) : undefined) ??
      tenantOverrideByEntity.get(device.entityId);
    const sourceName =
      device.name?.trim() ||
      (typeof device.attributes?.friendly_name === 'string' ? device.attributes.friendly_name.trim() : '') ||
      fallbackEntityDisplayName(device.entityId);
    const preCanonicalLabel = inferCanonicalLabel({ ...device, name: sourceName });

    if (tenantOverride) {
      const pending =
        tenantOverride.cleanupStatus === TenantDeviceCleanupStatus.PENDING_DEVICE_CLEANUP;
      const displayName =
        tenantOverride.displayName ||
        stripTenantHaTechnicalPrefix(tenantOverride.tenantUserId, sourceName) ||
        sourceName;
      const parentAreaName = tenantOverride.parentHaAreaName || device.areaName || device.area || null;
      const areaAlias = parentAreaName ? areaOverrideMap.get(parentAreaName)?.displayName : null;
      const displayAreaName =
        tenantOverride.tenantVirtualArea?.displayName || areaAlias || parentAreaName;
      const displayLabel = tenantOverride.displayLabel || 'tenant_device';
      const canonicalLabel = tenantOverride.canonicalLabel ?? preCanonicalLabel;
      return {
        ...device,
        sourceName,
        sourceAreaName: parentAreaName,
        sourceTechnicalLabel: firstLabel(device) || device.label || device.labelCategory || preCanonicalLabel,
        name: displayName,
        area: displayAreaName,
        areaName: displayAreaName,
        label: displayLabel,
        labelCategory: canonicalLabel,
        displayName,
        displayAreaName,
        parentAreaName,
        canonicalLabel,
        displayLabel,
        displayLabelKey: tenantOverride.displayLabelKey || normalizeLookupKey(displayLabel),
        ownership: pending ? 'pending_cleanup' : 'tenant_owned',
        tenantVirtualAreaId: tenantOverride.tenantVirtualAreaId,
        haTechnicalName: tenantOverride.haTechnicalName,
      };
    }

    const legacyOverride = deviceOverrideMap.get(device.entityId);
    const ownerFromIndex =
      (device.deviceId ? ownershipIndex.allTenantDeviceIds.get(device.deviceId) : undefined) ??
      ownershipIndex.allTenantEntityIds.get(device.entityId);
    const sourceAreaName = legacyOverride?.area || device.areaName || device.area || null;
    const sourceTechnicalLabel =
      legacyOverride?.label || firstLabel(device) || device.label || device.labelCategory || preCanonicalLabel;
    const capabilityDevice = {
      ...device,
      name: sourceName,
      label: sourceTechnicalLabel,
      labelCategory: device.labelCategory ?? sourceTechnicalLabel,
      technicalLabels: device.technicalLabels ?? device.labels ?? [sourceTechnicalLabel],
    };
    const canonicalLabel = inferCanonicalLabel(capabilityDevice);
    const displayAreaName = sourceAreaName
      ? areaOverrideMap.get(sourceAreaName)?.displayName ?? sourceAreaName
      : null;
    const labelAlias = labelOverrideMap.get(normalizeLookupKey(sourceTechnicalLabel));
    const displayLabel = labelAlias?.displayName ?? sourceTechnicalLabel;
    const pending =
      (device.deviceId ? ownershipIndex.pendingDeviceIds.has(device.deviceId) : false) ||
      ownershipIndex.pendingEntityIds.has(device.entityId);

    const fallbackTenantOwned = ownerFromIndex != null;
    const fallbackTenantName = fallbackTenantOwned
      ? stripTenantHaTechnicalPrefix(ownerFromIndex, legacyOverride?.name ?? sourceName) ||
        legacyOverride?.name ||
        sourceName
      : legacyOverride?.name?.trim() || sourceName;

    return {
      ...device,
      sourceName,
      sourceAreaName,
      sourceTechnicalLabel,
      name: fallbackTenantName,
      area: displayAreaName,
      areaName: displayAreaName,
      label: displayLabel,
      labelCategory: canonicalLabel,
      displayName: fallbackTenantName,
      displayAreaName,
      canonicalLabel,
      displayLabel,
      displayLabelKey: normalizeLookupKey(displayLabel),
      ownership: pending ? 'pending_cleanup' : fallbackTenantOwned ? 'tenant_owned' : 'installer',
      blindTravelSeconds:
        legacyOverride?.blindTravelSeconds != null
          ? legacyOverride.blindTravelSeconds
          : device.blindTravelSeconds ?? null,
    };
  });
}
