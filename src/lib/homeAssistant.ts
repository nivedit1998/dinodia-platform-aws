import { classifyDeviceByLabel, LabelCategory } from './labelCatalog';
import { HaWsClient } from '@/lib/haWebSocket';
import { safeLog } from '@/lib/safeLogger';

const DEFAULT_HA_TIMEOUT_MS = 6000;
const TEMPLATE_TIMEOUT_MS = 4000;

export type HaConnectionLike = {
  baseUrl: string;
  longLivedToken: string;
};

export type HAState = {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    [key: string]: unknown;
  };
};

export type TemplateDeviceMeta = {
  entity_id: string;
  area_name: string | null;
  device_id?: string | null;
  labels: string[];
};

export type HAEntityRegistryEntry = {
  entity_id: string;
  device_id: string | null;
  area_id?: string | null;
};

export type EnrichedDevice = {
  entityId: string;
  deviceId: string | null;
  name: string;
  state: string;
  areaName: string | null;
  labels: string[];
  labelCategory: LabelCategory | null;
  domain: string;
  attributes: Record<string, unknown>;
  servicesForTarget?: string[];
};

type ServicesForTargetCacheEntry = {
  services: string[];
  fetchedAt: number;
};

const SERVICES_FOR_TARGET_CACHE_TTL_MS = 15_000;

const globalForServicesCache = globalThis as unknown as {
  __haServicesForTargetCache?: Map<string, ServicesForTargetCacheEntry>;
};

function getServicesForTargetCache() {
  if (!globalForServicesCache.__haServicesForTargetCache) {
    globalForServicesCache.__haServicesForTargetCache = new Map();
  }
  return globalForServicesCache.__haServicesForTargetCache;
}

function buildServicesCacheKey(ha: HaConnectionLike, entityId: string) {
  return `${ha.baseUrl}::${entityId}`;
}

function buildTimeoutSignal(timeoutMs: number, externalSignal?: AbortSignal | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_HA_TIMEOUT_MS
) {
  const { signal, cancel } = buildTimeoutSignal(timeoutMs, init.signal);
  try {
    return await fetch(url, { ...init, signal });
  } finally {
    cancel();
  }
}

export async function callHomeAssistantAPI<T>(
  ha: HaConnectionLike,
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const url = `${ha.baseUrl}${path}`;
  const { timeoutMs = DEFAULT_HA_TIMEOUT_MS, ...restInit } = init ?? {};
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        ...restInit,
        headers: {
          Authorization: `Bearer ${ha.longLivedToken}`,
          'Content-Type': 'application/json',
          ...(restInit.headers || {}),
        },
      },
      timeoutMs
    );
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`HA API timeout after ${timeoutMs}ms on ${path}`);
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HA API error ${res.status} on ${path}: ${text}`);
  }
  if (res.status === 204) {
    return null as T;
  }
  const text = await res.text();
  if (!text) {
    return null as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `HA API error: expected JSON response on ${path} but got non-JSON body: ${String(err)}`
    );
  }
}

export async function renderHomeAssistantTemplate<T>(
  ha: HaConnectionLike,
  template: string,
  timeoutMs = TEMPLATE_TIMEOUT_MS
): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${ha.baseUrl}/api/template`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ha.longLivedToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ template }),
      },
      timeoutMs
    );
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`HA template timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HA template error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function fetchTemplateMeta(
  ha: HaConnectionLike,
  template: string
): Promise<TemplateDeviceMeta[]> {
  if (process.env.SKIP_HA_TEMPLATE_META === 'true') {
    return [];
  }
  try {
    return await renderHomeAssistantTemplate<TemplateDeviceMeta[]>(ha, template);
  } catch (err) {
    safeLog('warn', '[homeAssistant] Template metadata failed; continuing without metadata', {
      error: err,
    });
    return [];
  }
}

export async function getEntityRegistryMap(ha: HaConnectionLike) {
  const map = new Map<string, string | null>();

  // Prefer WS (works on more HA installs). REST 404s on some setups.
  try {
    const client = await HaWsClient.connect(ha);
    try {
      const entries = await client.call<HAEntityRegistryEntry[]>('config/entity_registry/list');
      for (const entry of entries) {
        if (!entry?.entity_id) continue;
        map.set(entry.entity_id, entry.device_id ?? null);
      }
      return map;
    } finally {
      client.close();
    }
  } catch (err) {
    safeLog('warn', '[homeAssistant] Entity registry WS fetch failed; using fallback', {
      error: err,
    });
  }

  // REST fallback (might 404; suppress noisy logs)
  try {
    const registry = await callHomeAssistantAPI<HAEntityRegistryEntry[]>(
      ha,
      '/api/config/entity_registry'
    );
    for (const entry of registry) {
      if (!entry?.entity_id) continue;
      map.set(entry.entity_id, entry.device_id ?? null);
    }
  } catch {
    // ignore
  }

  return map;
}

export async function getServicesForTargetWs(
  ha: HaConnectionLike,
  entityId: string
): Promise<string[]> {
  const normalizedEntityId = String(entityId || '').trim();
  if (!normalizedEntityId) return [];

  const client = await HaWsClient.connect(ha);
  try {
    const result = await client.call<unknown>('get_services_for_target', {
      target: { entity_id: [normalizedEntityId] },
      expand_group: true,
    });

    if (!Array.isArray(result)) return [];

    return result.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== ''
    );
  } finally {
    client.close();
  }
}

export async function getServicesForTargetCached(
  ha: HaConnectionLike,
  entityId: string,
  ttlMs = SERVICES_FOR_TARGET_CACHE_TTL_MS
): Promise<string[]> {
  const normalizedEntityId = String(entityId || '').trim();
  if (!normalizedEntityId) return [];

  const cache = getServicesForTargetCache();
  const key = buildServicesCacheKey(ha, normalizedEntityId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return cached.services;
  }

  const services = await getServicesForTargetWs(ha, normalizedEntityId);
  cache.set(key, { services, fetchedAt: Date.now() });
  return services;
}

export async function getDevicesWithMetadata(
  ha: HaConnectionLike
): Promise<EnrichedDevice[]> {
  const template = `{% set ns = namespace(result=[]) %}
{% for s in states %}
  {% set item = {
    "entity_id": s.entity_id,
    "area_name": area_name(s.entity_id),
    "device_id": device_id(s.entity_id),
    "labels": (labels(s.entity_id) | map('label_name') | list)
  } %}
  {% set ns.result = ns.result + [item] %}
{% endfor %}
{{ ns.result | tojson }}`;

  const [states, meta, registryMap] = await Promise.all([
    callHomeAssistantAPI<HAState[]>(ha, '/api/states'),
    fetchTemplateMeta(ha, template),
    getEntityRegistryMap(ha),
  ]);

  const metaByEntity = new Map<string, TemplateDeviceMeta>();
  for (const m of meta) {
    metaByEntity.set(m.entity_id, m);
  }

  if (process.env.NODE_ENV !== 'production') {
    safeLog('debug', '[homeAssistant] Template metadata loaded', {
      stateCount: states.length,
      metadataCount: meta.length,
    });
  }

  return states.map((s) => {
    const domain = s.entity_id.split('.')[0] || '';
    const metaEntry = metaByEntity.get(s.entity_id);
    const deviceId = metaEntry?.device_id ?? registryMap.get(s.entity_id) ?? null;
    const labels = (metaEntry?.labels ?? []).filter(
      (label): label is string => typeof label === 'string' && label.trim() !== ''
    );
    const labelCategory =
      classifyDeviceByLabel(labels) ?? classifyDeviceByLabel([domain]);

    return {
      entityId: s.entity_id,
      deviceId,
      name: s.attributes.friendly_name ?? s.entity_id,
      state: s.state,
      areaName: metaEntry?.area_name ?? null,
      labels,
      labelCategory,
      domain,
      attributes: s.attributes ?? {},
    };
  });
}

type TemplateLabeledDeviceState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  area_name: string | null;
  device_id?: string | null;
  labels: string[];
};

export async function getLabeledDevicesWithMetadata(
  ha: HaConnectionLike
): Promise<EnrichedDevice[]> {
  if (process.env.SKIP_HA_TEMPLATE_META === 'true') {
    return [];
  }

  const template = `{% set ns = namespace(result=[]) %}
{% for s in states %}
  {% set labels_list = (labels(s.entity_id) | map('label_name') | list) %}
  {% if labels_list | length > 0 %}
    {% set item = {
      "entity_id": s.entity_id,
      "state": s.state,
      "attributes": s.attributes,
      "area_name": area_name(s.entity_id),
      "device_id": device_id(s.entity_id),
      "labels": labels_list
    } %}
    {% set ns.result = ns.result + [item] %}
  {% endif %}
{% endfor %}
{{ ns.result | tojson }}`;

  const labeled = await renderHomeAssistantTemplate<TemplateLabeledDeviceState[]>(ha, template);
  const anyMissingDeviceId = labeled.some((m) => !m.device_id);
  const registryMap = anyMissingDeviceId
    ? await getEntityRegistryMap(ha)
    : new Map<string, string | null>();

  if (process.env.NODE_ENV !== 'production') {
    safeLog('debug', '[homeAssistant] Labeled devices template loaded', {
      labeledCount: labeled.length,
      missingDeviceId: anyMissingDeviceId,
    });
  }

  return labeled.map((entry) => {
    const domain = entry.entity_id.split('.')[0] || '';
    const deviceId = entry.device_id ?? registryMap.get(entry.entity_id) ?? null;
    const labels = Array.isArray(entry.labels)
      ? entry.labels.filter(
          (label): label is string => typeof label === 'string' && label.trim() !== ''
        )
      : [];
    const labelCategory =
      classifyDeviceByLabel(labels) ?? classifyDeviceByLabel([domain]);

    const friendlyNameRaw = entry.attributes?.['friendly_name'];
    const friendlyName = typeof friendlyNameRaw === 'string' ? friendlyNameRaw : undefined;

    return {
      entityId: entry.entity_id,
      deviceId,
      name: friendlyName ?? entry.entity_id,
      state: entry.state,
      areaName: entry.area_name ?? null,
      labels,
      labelCategory,
      domain,
      attributes: entry.attributes ?? {},
    };
  });
}

export async function callHaService(
  ha: HaConnectionLike,
  domain: string,
  service: string,
  data: Record<string, unknown> = {}
) {
  const url = `${ha.baseUrl}/api/services/${domain}/${service}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ha.longLivedToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
      DEFAULT_HA_TIMEOUT_MS
    );
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`HA service timeout after ${DEFAULT_HA_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HA service error ${res.status}: ${text}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchHaState(
  ha: HaConnectionLike,
  entityId: string
): Promise<HAState> {
  return callHomeAssistantAPI<HAState>(ha, `/api/states/${entityId}`);
}
