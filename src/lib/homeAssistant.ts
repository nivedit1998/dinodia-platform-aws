import { classifyDeviceByLabel, LabelCategory } from './labelCatalog';

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
};

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
  return (await res.json()) as T;
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
    console.warn('HA template metadata failed (continuing without metadata):', err);
    return [];
  }
}

export async function getEntityRegistryMap(ha: HaConnectionLike) {
  try {
    const registry = await callHomeAssistantAPI<HAEntityRegistryEntry[]>(
      ha,
      '/api/config/entity_registry'
    );
    const map = new Map<string, string | null>();
    for (const entry of registry) {
      if (!entry?.entity_id) continue;
      map.set(entry.entity_id, entry.device_id ?? null);
    }
    return map;
  } catch (err) {
    console.warn('HA entity registry fetch failed (continuing without device ids):', err);
    return new Map<string, string | null>();
  }
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
    console.log(
      '[homeAssistant] template meta sample:',
      meta.slice(0, 3).map((m) => ({
        entity_id: m.entity_id,
        area_name: m.area_name,
        device_id: m.device_id,
        labels: m.labels,
      }))
    );
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
