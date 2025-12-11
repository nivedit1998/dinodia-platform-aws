import { prisma } from '@/lib/prisma';
import {
  EnrichedDevice,
  HAState,
  callHomeAssistantAPI,
  getDevicesWithMetadata,
  getEntityRegistryMap,
} from '@/lib/homeAssistant';
import { resolveHaCloudFirst } from '@/lib/haConnection';
import { classifyDeviceByLabel } from '@/lib/labelCatalog';
import { buildFallbackDeviceId } from '@/lib/deviceIdentity';
import type { UIDevice } from '@/types/device';

type DeviceFetchOptions = {
  logSample?: boolean;
  bypassCache?: boolean;
  cacheTtlMs?: number;
};

type DeviceCacheEntry = {
  devices: UIDevice[];
  fetchedAt: number;
};

const DEFAULT_CACHE_TTL_MS = 3000;

const globalForCache = globalThis as unknown as {
  __devicesCache?: Map<number, DeviceCacheEntry>;
};

function getDeviceCache() {
  if (!globalForCache.__devicesCache) {
    globalForCache.__devicesCache = new Map();
  }
  return globalForCache.__devicesCache;
}

async function fetchEnrichedDevicesWithFallback(
  haConnection: { id: number; baseUrl: string; cloudUrl: string | null; longLivedToken: string }
): Promise<EnrichedDevice[]> {
  const effectiveHa = resolveHaCloudFirst(haConnection);
  const fetchStartedAt = Date.now();

  let enriched: EnrichedDevice[] = [];
  try {
    enriched = await getDevicesWithMetadata(effectiveHa);
  } catch (err) {
    console.warn('[devicesSnapshot] metadata failed, falling back to states-only', err);
    try {
      const [states, registryMap] = await Promise.all([
        callHomeAssistantAPI<HAState[]>(effectiveHa, '/api/states'),
        getEntityRegistryMap(effectiveHa),
      ]);
      enriched = states.map((s) => {
        const domain = s.entity_id.split('.')[0] || '';
        return {
          entityId: s.entity_id,
          deviceId: registryMap.get(s.entity_id) ?? null,
          name: s.attributes.friendly_name ?? s.entity_id,
          state: s.state,
          areaName: null,
          labels: [],
          labelCategory: null,
          domain,
          attributes: s.attributes ?? {},
        };
      });
    } catch (fallbackErr) {
      console.error(
        '[devicesSnapshot] Failed to fetch devices from HA (cloud-first) after fallback:',
        fallbackErr
      );
      throw new Error('Failed to fetch HA devices');
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[devicesSnapshot] fetched from HA', {
      haConnectionId: haConnection.id,
      count: enriched.length,
      ms: Date.now() - fetchStartedAt,
    });
  }

  return enriched;
}

function shapeDevices(
  enriched: EnrichedDevice[],
  overrideMap: Map<
    string,
    {
      entityId: string;
      name: string;
      area: string | null;
      label: string | null;
    }
  >
): UIDevice[] {
  return enriched.map((d) => {
    const override = overrideMap.get(d.entityId);
    const name = override?.name ?? d.name;
    const areaName = override?.area ?? d.areaName ?? null;
    const labels = override?.label ? [override.label] : d.labels;
    const labelCategory = classifyDeviceByLabel(labels ?? []) ?? d.labelCategory ?? null;
    const primaryLabel =
      labels && labels.length > 0 && labels[0] ? String(labels[0]) : null;
    const label = override?.label ?? primaryLabel ?? labelCategory ?? null;
    const deviceId =
      d.deviceId ??
      buildFallbackDeviceId({
        entityId: d.entityId,
        name,
        areaName,
        area: areaName,
      });

    return {
      entityId: d.entityId,
      deviceId,
      name,
      state: d.state,
      area: areaName,
      areaName,
      labels,
      label,
      labelCategory,
      domain: d.domain,
      attributes: d.attributes ?? {},
    };
  });
}

function logSample(devices: UIDevice[]) {
  const interestingLabels = new Set(['Motion Sensor', 'TV', 'Spotify']);
  const sample = devices.filter((d) => {
    const labels = Array.isArray(d.labels) ? d.labels : [];
    const candidates = [d.label ?? '', ...labels, d.labelCategory ?? ''].map((lbl) =>
      lbl ? lbl.toString().trim() : ''
    );
    return candidates.some((lbl) => interestingLabels.has(lbl));
  });

  if (sample.length > 0) {
    console.log('[devicesSnapshot] sample', sample.slice(0, 10));
  }
}

export async function getDevicesForHaConnection(
  haConnectionId: number,
  opts: DeviceFetchOptions = {}
): Promise<UIDevice[]> {
  const cache = getDeviceCache();
  const cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!opts.bypassCache && cacheTtlMs > 0) {
    const cached = cache.get(haConnectionId);
    if (cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
      return cached.devices;
    }
  }

  const haConnection = await prisma.haConnection.findUnique({
    where: { id: haConnectionId },
    select: {
      id: true,
      baseUrl: true,
      cloudUrl: true,
      longLivedToken: true,
    },
  });

  if (!haConnection) {
    throw new Error(`HA connection ${haConnectionId} not found`);
  }

  const enriched = await fetchEnrichedDevicesWithFallback(haConnection);

  const dbDevices = await prisma.device.findMany({
    where: { haConnectionId },
  });
  const overrideMap = new Map(dbDevices.map((d) => [d.entityId, d]));

  const devices = shapeDevices(enriched, overrideMap);

  if (opts.logSample && process.env.NODE_ENV !== 'production') {
    logSample(devices);
  }

  cache.set(haConnectionId, { devices, fetchedAt: Date.now() });

  return devices;
}
