import { prisma } from '@/lib/prisma';
import {
  EnrichedDevice,
  HAState,
  callHomeAssistantAPI,
  getDevicesWithMetadata,
  getEntityRegistryMap,
} from '@/lib/homeAssistant';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { classifyDeviceByLabel } from '@/lib/labelCatalog';
import { buildFallbackDeviceId } from '@/lib/deviceIdentity';
import type { UIDevice } from '@/types/device';
import { resolveHaLongLivedToken } from '@/lib/haSecrets';
import { safeLog } from '@/lib/safeLogger';

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
  ha: HaConnectionLike,
  haConnectionId: number
): Promise<EnrichedDevice[]> {
  const fetchStartedAt = Date.now();

  let enriched: EnrichedDevice[] = [];
  try {
    enriched = await getDevicesWithMetadata(ha);
  } catch (err) {
    safeLog('warn', '[devicesSnapshot] metadata failed, falling back to states-only', {
      haConnectionId,
      error: err,
    });
    try {
      const [states, registryMap] = await Promise.all([
        callHomeAssistantAPI<HAState[]>(ha, '/api/states'),
        getEntityRegistryMap(ha),
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
      safeLog('error', '[devicesSnapshot] Failed to fetch devices from HA after fallback', {
        haConnectionId,
        error: fallbackErr,
      });
      throw new Error('Dinodia Hub did not respond when loading devices.');
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    safeLog('debug', '[devicesSnapshot] fetched from HA', {
      haConnectionId,
      count: enriched.length,
      ms: Date.now() - fetchStartedAt,
    });
  }

  return enriched;
}

type DeviceOverride = {
  entityId: string;
  name: string;
  blindTravelSeconds: number | null;
};

function shapeDevices(
  enriched: EnrichedDevice[],
  overrideMap: Map<string, DeviceOverride>
): UIDevice[] {
  return enriched.map((d) => {
    const override = overrideMap.get(d.entityId);
    const name = override?.name ?? d.name;
    // Area/label come from HA metadata; DB overrides no longer apply.
    const areaName = d.areaName ?? null;
    const labels = d.labels;
    const labelCategory = classifyDeviceByLabel(labels ?? []) ?? d.labelCategory ?? null;
    const primaryLabel =
      labels && labels.length > 0 && labels[0] ? String(labels[0]) : null;
    const label = primaryLabel ?? labelCategory ?? null;
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
      blindTravelSeconds:
        override?.blindTravelSeconds != null ? override.blindTravelSeconds : null,
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
    safeLog('debug', '[devicesSnapshot] sample summary', {
      sampleCount: sample.length,
      totalCount: devices.length,
    });
  }
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function buildHaCandidates(haConnection: {
  baseUrl: string;
  cloudUrl: string | null;
  longLivedToken: string;
}): HaConnectionLike[] {
  const candidates: HaConnectionLike[] = [];
  const seen = new Set<string>();
  const cloud = haConnection.cloudUrl ? normalizeUrl(haConnection.cloudUrl) : '';
  const base = normalizeUrl(haConnection.baseUrl);

  if (cloud && !seen.has(cloud)) {
    candidates.push({ baseUrl: cloud, longLivedToken: haConnection.longLivedToken });
    seen.add(cloud);
  }
  if (base && !seen.has(base)) {
    candidates.push({ baseUrl: base, longLivedToken: haConnection.longLivedToken });
  }

  return candidates;
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
      longLivedTokenCiphertext: true,
    },
  });

  if (!haConnection) {
    throw new Error(`HA connection ${haConnectionId} not found`);
  }

  const { longLivedToken } = resolveHaLongLivedToken(haConnection);
  const hydrated = { ...haConnection, longLivedToken };

  const candidates = buildHaCandidates(hydrated);
  let enriched: EnrichedDevice[] | null = null;
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      enriched = await fetchEnrichedDevicesWithFallback(candidate, haConnectionId);
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!enriched) {
    throw lastError instanceof Error
      ? lastError
      : new Error('Dinodia Hub did not respond when loading devices.');
  }

  const dbDevices = await prisma.device.findMany({
    where: { haConnectionId },
  });
  const overrideMap: Map<string, DeviceOverride> = new Map(
    dbDevices.map((d) => [
      d.entityId,
      {
        entityId: d.entityId,
        name: d.name,
        blindTravelSeconds:
          typeof d.blindTravelSeconds === 'number' ? d.blindTravelSeconds : null,
      },
    ])
  );

  const devices = shapeDevices(enriched, overrideMap);

  if (opts.logSample && process.env.NODE_ENV !== 'production') {
    logSample(devices);
  }

  cache.set(haConnectionId, { devices, fetchedAt: Date.now() });

  return devices;
}
