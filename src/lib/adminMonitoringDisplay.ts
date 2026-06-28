import { prisma } from '@/lib/prisma';
import { normalizeLookupKey } from '@/lib/displayNormalization';
import { OTHER_LABEL } from '@/lib/deviceLabels';
import { isTenantDeviceLabelValue } from '@/lib/tenantDeviceLabel';

export const UNASSIGNED_AREA = 'Unassigned';

export type MonitoringDisplayContext = {
  displayName(entityId: string): string;
  displayArea(entityId: string): string;
  displayAreaName(area: string | null | undefined): string;
  displayAreaKey(entityId: string): string;
  displayAreaKeyForArea(area: string | null | undefined): string;
  displayAreaNameForKey(displayKey: string): string | null;
  sourceAreasForDisplayKey(displayKey: string): string[];
  matchesRequestedDisplayAreas(entityId: string, requestedAreas: Set<string>): boolean;
  matchesRequestedAreaValue(area: string | null | undefined, requestedAreas: Set<string>): boolean;
  displayLabel(entityId: string): string | null;
  sourceArea(entityId: string): string | null;
  sourceLabel(entityId: string): string | null;
  isVisibleEntity(entityId: string): boolean;
  isVisibleLabel(label: string | null | undefined): boolean;
};

function fallbackEntityDisplayName(entityId: string) {
  const objectId = entityId.includes('.') ? entityId.split('.').slice(1).join('.') : entityId;
  return objectId
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || entityId;
}

function inferLabel(entityId: string, existing?: string | null) {
  const cleaned = existing?.trim();
  if (cleaned) return cleaned;
  const id = entityId.toLowerCase();
  if (id.includes('blind')) return 'Blind';
  if (id.includes('motion')) return 'Motion Sensor';
  if (id.includes('spotify')) return 'Spotify';
  if (id.includes('boiler')) return 'Boiler';
  if (id.includes('radiator')) return 'Radiator';
  if (id.includes('doorbell')) return 'Doorbell';
  if (id.includes('security')) return 'Home Security';
  if (id.includes('tv')) return 'TV';
  if (id.includes('speaker')) return 'Speaker';
  if (id.includes('light') || id.includes('lamp') || id.includes('spotlight')) return 'Light';
  return null;
}

export async function buildMonitoringDisplayContext(args: {
  haConnectionId: number;
  entityIds: string[];
}): Promise<MonitoringDisplayContext> {
  const entityIds = Array.from(new Set(args.entityIds.filter(Boolean)));
  const [devices, areaOverrides, labelOverrides] = await Promise.all([
    entityIds.length
      ? prisma.device.findMany({
          where: { haConnectionId: args.haConnectionId, entityId: { in: entityIds } },
          select: { entityId: true, name: true, area: true, label: true },
        })
      : Promise.resolve([]),
    prisma.areaDisplayOverride.findMany({
      where: { haConnectionId: args.haConnectionId },
      select: { haAreaName: true, displayName: true, displayKey: true },
    }),
    prisma.labelDisplayOverride.findMany({
      where: { haConnectionId: args.haConnectionId },
      select: { sourceTechnicalLabel: true, displayName: true },
    }),
  ]);

  const deviceByEntity = new Map(devices.map((device) => [device.entityId, device]));
  const areaOverrideBySource = new Map(areaOverrides.map((row) => [row.haAreaName, row]));
  const labelOverrideBySource = new Map(
    labelOverrides.map((row) => [normalizeLookupKey(row.sourceTechnicalLabel), row.displayName])
  );
  const rawAreasByDisplayKey = new Map<string, Set<string>>();
  const displayNameByDisplayKey = new Map<string, string>();

  const addRawAreaToDisplayKey = (rawArea: string) => {
    const override = areaOverrideBySource.get(rawArea);
    const displayName = override?.displayName?.trim() || rawArea;
    const displayKey = override?.displayKey?.trim() || normalizeLookupKey(displayName || rawArea);
    if (!rawAreasByDisplayKey.has(displayKey)) {
      rawAreasByDisplayKey.set(displayKey, new Set<string>());
    }
    rawAreasByDisplayKey.get(displayKey)!.add(rawArea);
    if (!displayNameByDisplayKey.has(displayKey) && displayName) {
      displayNameByDisplayKey.set(displayKey, displayName);
    }
    return displayKey;
  };

  for (const row of areaOverrides) {
    addRawAreaToDisplayKey(row.haAreaName);
  }
  for (const device of devices) {
    const source = device.area?.trim();
    if (source) addRawAreaToDisplayKey(source);
  }

  const isVisibleLabel = (label: string | null | undefined) => {
    const key = normalizeLookupKey(label ?? '');
    return Boolean(key) && key !== normalizeLookupKey(OTHER_LABEL) && !isTenantDeviceLabelValue(label);
  };

  const sourceArea = (entityId: string) => {
    const area = deviceByEntity.get(entityId)?.area?.trim();
    return area || null;
  };

  const displayAreaKeyForArea = (area: string | null | undefined) => {
    const source = area?.trim();
    if (!source) return normalizeLookupKey(UNASSIGNED_AREA);
    return addRawAreaToDisplayKey(source);
  };

  const sourceLabel = (entityId: string) => {
    return inferLabel(entityId, deviceByEntity.get(entityId)?.label);
  };

  const displayLabel = (entityId: string) => {
    const source = sourceLabel(entityId);
    if (!source) return null;
    return labelOverrideBySource.get(normalizeLookupKey(source)) ?? source;
  };

  const displayAreaKey = (entityId: string) => {
    return displayAreaKeyForArea(sourceArea(entityId));
  };

  const displayAreaNameForKey = (displayKey: string) => {
    const cleaned = displayKey.trim();
    if (!cleaned) return null;
    return displayNameByDisplayKey.get(cleaned) ?? null;
  };

  const sourceAreasForDisplayKey = (displayKey: string) => {
    const cleaned = displayKey.trim();
    if (!cleaned) return [];
    return Array.from(rawAreasByDisplayKey.get(cleaned) ?? []).sort((left, right) => left.localeCompare(right));
  };

  const normalizeRequestedAreaKeys = (requestedAreas: Set<string>) => {
    const keys = new Set<string>();
    for (const requestedArea of requestedAreas) {
      const trimmed = requestedArea.trim();
      if (!trimmed) continue;
      keys.add(normalizeLookupKey(trimmed));
      keys.add(displayAreaKeyForArea(trimmed));
    }
    return keys;
  };

  const matchesRequestedAreaValue = (area: string | null | undefined, requestedAreas: Set<string>) => {
    if (requestedAreas.size === 0) return true;
    const areaKey = displayAreaKeyForArea(area);
    const requestedKeys = normalizeRequestedAreaKeys(requestedAreas);
    if (requestedKeys.has(areaKey)) return true;
    const source = area?.trim();
    return Boolean(source && requestedKeys.has(normalizeLookupKey(source)));
  };

  const matchesRequestedDisplayAreas = (entityId: string, requestedAreas: Set<string>) => {
    if (requestedAreas.size === 0) return true;
    return matchesRequestedAreaValue(sourceArea(entityId), requestedAreas);
  };

  return {
    displayName(entityId) {
      return deviceByEntity.get(entityId)?.name?.trim() || fallbackEntityDisplayName(entityId);
    },
    displayArea(entityId) {
      const source = sourceArea(entityId);
      if (!source) return UNASSIGNED_AREA;
      return areaOverrideBySource.get(source)?.displayName ?? source;
    },
    displayAreaName(area) {
      const source = area?.trim();
      if (!source) return UNASSIGNED_AREA;
      return areaOverrideBySource.get(source)?.displayName ?? source;
    },
    displayAreaKey,
    displayAreaKeyForArea,
    displayAreaNameForKey,
    sourceAreasForDisplayKey,
    matchesRequestedDisplayAreas,
    matchesRequestedAreaValue,
    displayLabel,
    sourceArea,
    sourceLabel,
    isVisibleEntity(entityId) {
      return isVisibleLabel(displayLabel(entityId));
    },
    isVisibleLabel,
  };
}
