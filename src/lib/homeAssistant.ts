import { classifyDeviceByLabel, LabelCategory } from './labelCatalog';

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
  labels: string[];
};

export type EnrichedDevice = {
  entityId: string;
  name: string;
  state: string;
  areaName: string | null;
  labels: string[];
  labelCategory: LabelCategory | null;
  domain: string;
  attributes: Record<string, unknown>;
};

export async function callHomeAssistantAPI<T>(
  ha: HaConnectionLike,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = `${ha.baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${ha.longLivedToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HA API error ${res.status} on ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function renderHomeAssistantTemplate<T>(
  ha: HaConnectionLike,
  template: string
): Promise<T> {
  const res = await fetch(`${ha.baseUrl}/api/template`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ha.longLivedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ template }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HA template error ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function getDevicesWithMetadata(
  ha: HaConnectionLike
): Promise<EnrichedDevice[]> {
  const states = await callHomeAssistantAPI<HAState[]>(ha, '/api/states');

  const template = `{% set ns = namespace(result=[]) %}
{% for s in states %}
  {% set item = {
    "entity_id": s.entity_id,
    "area_name": area_name(s.entity_id),
    "labels": (labels(s.entity_id) | map('label_name') | list)
  } %}
  {% set ns.result = ns.result + [item] %}
{% endfor %}
{{ ns.result | tojson }}`;

  let meta: TemplateDeviceMeta[] = [];
  try {
    meta = await renderHomeAssistantTemplate<TemplateDeviceMeta[]>(ha, template);
  } catch (err) {
    console.warn('HA template metadata failed:', err);
    meta = [];
  }

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
        labels: m.labels,
      }))
    );
  }

  return states.map((s) => {
    const domain = s.entity_id.split('.')[0] || '';
    const metaEntry = metaByEntity.get(s.entity_id);
    const labels = (metaEntry?.labels ?? []).filter(
      (label): label is string => typeof label === 'string' && label.trim() !== ''
    );
    const labelCategory =
      classifyDeviceByLabel(labels) ?? classifyDeviceByLabel([domain]);

    return {
      entityId: s.entity_id,
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
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ha.longLivedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
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
