import { randomUUID } from 'crypto';
import { callHaService, callHomeAssistantAPI, HaConnectionLike, HAState } from '@/lib/homeAssistant';
import { HaWsClient } from '@/lib/haWebSocket';

export type HaAutomationConfig = {
  id: string;
  entityId?: string;
  alias: string;
  description?: string;
  mode?: string;
  triggers?: unknown[];
  conditions?: unknown[];
  actions?: unknown[];
  // Back-compat: some payloads may still use these keys.
  trigger?: unknown[];
  condition?: unknown[];
  action?: unknown[];
};

type ScheduleType = 'daily' | 'weekly' | 'monthly';

export type AutomationDraftTrigger =
  | {
      type: 'state';
      entityId: string;
      to?: string;
      from?: string;
      forSeconds?: number;
    }
  | {
      type: 'schedule';
      scheduleType: ScheduleType;
      at: string; // HH:MM or HH:MM:SS
      weekdays?: string[]; // mon,tue...
      day?: number; // 1-31 for monthly
    };

export type AutomationDraftAction =
  | { type: 'toggle'; entityId: string }
  | { type: 'turn_on'; entityId: string }
  | { type: 'turn_off'; entityId: string }
  | { type: 'set_brightness'; entityId: string; value: number }
  | { type: 'set_temperature'; entityId: string; value: number };

export type AutomationDraft = {
  alias: string;
  description?: string;
  mode?: 'single' | 'restart' | 'queued' | 'parallel';
  enabled?: boolean;
  trigger: AutomationDraftTrigger;
  action: AutomationDraftAction;
};

function safeTimeString(at: string) {
  // Normalize "HH:MM" to "HH:MM:SS"
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(at)) return at;
  if (/^\d{1,2}:\d{2}$/.test(at)) return `${at}:00`;
  throw new Error('Invalid time format; expected HH:MM or HH:MM:SS');
}

function buildStateTrigger(trigger: Extract<AutomationDraftTrigger, { type: 'state' }>) {
  const obj: Record<string, unknown> = {
    trigger: 'state',
    entity_id: trigger.entityId,
  };
  if (trigger.to) obj.to = trigger.to;
  if (trigger.from) obj.from = trigger.from;
  if (typeof trigger.forSeconds === 'number' && trigger.forSeconds > 0) {
    obj.for = { seconds: trigger.forSeconds };
  }
  return obj;
}

function buildSchedulePieces(trigger: Extract<AutomationDraftTrigger, { type: 'schedule' }>) {
  const at = safeTimeString(trigger.at);
  const baseTrigger: Record<string, unknown> = { trigger: 'time', at };
  const conditions: unknown[] = [];

  if (trigger.scheduleType === 'weekly') {
    const weekdays =
      trigger.weekdays && trigger.weekdays.length > 0
        ? trigger.weekdays
        : ['mon'];
    baseTrigger.weekday = weekdays;
  } else if (trigger.scheduleType === 'monthly') {
    const day = trigger.day && trigger.day >= 1 && trigger.day <= 31 ? trigger.day : 1;
    // Template condition is the simplest portable approach for monthly cadence.
    conditions.push({
      condition: 'template',
      value_template: `{{ now().day == ${day} }}`,
    });
  }

  return { trigger: baseTrigger, conditions };
}

function clamp(num: number, min: number, max: number) {
  return Math.min(Math.max(num, min), max);
}

function buildAction(action: AutomationDraftAction) {
  const target = { entity_id: action.entityId };
  switch (action.type) {
    case 'toggle':
      return { service: 'homeassistant.toggle', target };
    case 'turn_on':
      return { service: 'homeassistant.turn_on', target };
    case 'turn_off':
      return { service: 'homeassistant.turn_off', target };
    case 'set_brightness':
      return {
        service: 'light.turn_on',
        target,
        data: { brightness_pct: clamp(action.value, 0, 100) },
      };
    case 'set_temperature':
      return {
        service: 'climate.set_temperature',
        target,
        data: { temperature: action.value },
      };
    default:
      // Exhaustive guard
      throw new Error('Unsupported action');
  }
}

export function buildHaAutomationConfigFromDraft(
  draft: AutomationDraft,
  automationId?: string
): HaAutomationConfig {
  const triggers =
    draft.trigger.type === 'state'
      ? [buildStateTrigger(draft.trigger)]
      : (() => {
          const pieces = buildSchedulePieces(draft.trigger);
          return [pieces.trigger];
        })();

  const conditions =
    draft.trigger.type === 'schedule'
      ? buildSchedulePieces(draft.trigger).conditions
      : [];

  const actions = [buildAction(draft.action)];

  const rawId = automationId || `dinodia_${randomUUID()}`;
  const id = rawId.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

  return {
    id,
    alias: draft.alias,
    description: draft.description || 'Created via Dinodia',
    mode: draft.mode || 'single',
    triggers,
    conditions,
    actions,
    // Back-compat keys (some HA paths still accept these).
    trigger: triggers,
    condition: conditions,
    action: actions,
  };
}

export async function listAutomationConfigs(ha: HaConnectionLike): Promise<HaAutomationConfig[]> {
  // HA frontend uses per-entity WS `automation/config` + REST save/delete.
  // We list automation entities via /api/states and fetch configs via WS.
  const states = await callHomeAssistantAPI<HAState[]>(ha, '/api/states');
  const automationEntities = states
    .map((s) => s.entity_id)
    .filter((id) => typeof id === 'string' && id.startsWith('automation.'));

  const client = await HaWsClient.connect(ha);
  try {
    const results: HaAutomationConfig[] = [];
    // Small concurrency limit to avoid overloading HA.
    const concurrency = 6;
    for (let i = 0; i < automationEntities.length; i += concurrency) {
      const batch = automationEntities.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (entityId) => {
          const response = await client.call<{ config: Record<string, unknown> }>('automation/config', {
            entity_id: entityId,
          });
          const cfg = response?.config ?? {};
          const rawId = typeof cfg.id === 'string' ? cfg.id.trim() : '';
          const id = rawId.length > 0 ? rawId : entityId.slice('automation.'.length);
          const triggersRaw = (cfg.triggers ?? cfg.trigger) as unknown;
          const conditionsRaw = (cfg.conditions ?? cfg.condition) as unknown;
          const actionsRaw = (cfg.actions ?? cfg.action) as unknown;
          const triggers = Array.isArray(triggersRaw) ? triggersRaw : triggersRaw ? [triggersRaw] : [];
          const conditions = Array.isArray(conditionsRaw) ? conditionsRaw : conditionsRaw ? [conditionsRaw] : [];
          const actions = Array.isArray(actionsRaw) ? actionsRaw : actionsRaw ? [actionsRaw] : [];
          return {
            id,
            entityId,
            alias: typeof cfg.alias === 'string' ? cfg.alias : entityId,
            description: typeof cfg.description === 'string' ? cfg.description : '',
            mode: typeof cfg.mode === 'string' ? cfg.mode : 'single',
            triggers,
            conditions,
            actions,
          } satisfies HaAutomationConfig;
        })
      );
      results.push(...batchResults);
    }
    return results;
  } finally {
    client.close();
  }
}

export async function createAutomation(ha: HaConnectionLike, config: HaAutomationConfig) {
  // HA frontend: POST /api/config/automation/config/<id>
  await callHomeAssistantAPI<unknown>(ha, `/api/config/automation/config/${encodeURIComponent(config.id)}`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
  return { id: config.id };
}

export async function updateAutomation(
  ha: HaConnectionLike,
  automationId: string,
  config: HaAutomationConfig
) {
  await callHomeAssistantAPI<unknown>(ha, `/api/config/automation/config/${encodeURIComponent(automationId)}`, {
    method: 'POST',
    body: JSON.stringify({ ...config, id: automationId }),
  });
  return { ok: true };
}

export async function deleteAutomation(ha: HaConnectionLike, automationId: string) {
  await callHomeAssistantAPI<unknown>(ha, `/api/config/automation/config/${encodeURIComponent(automationId)}`, {
    method: 'DELETE',
  });
  return { ok: true };
}

export async function setAutomationEnabled(
  ha: HaConnectionLike,
  automationId: string,
  enabled: boolean
) {
  // Service toggle expects automation entity_id (automation.<id>).
  const entityId = automationId.includes('.') ? automationId : `automation.${automationId}`;
  const service = enabled ? 'turn_on' : 'turn_off';
  await callHaService(ha, 'automation', service, { entity_id: entityId });
}

export function extractEntityIdsFromAutomationConfig(config: HaAutomationConfig) {
  const entities = new Set<string>();
  let hasTemplates = false;

  function visit(node: unknown) {
    if (node == null) return;
    if (typeof node === 'string') {
      if (node.includes('{{')) {
        hasTemplates = true;
        return;
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'entity_id' || key === 'entityId') {
          if (typeof value === 'string') {
            if (!value.includes('{{')) entities.add(value);
            else hasTemplates = true;
          } else if (Array.isArray(value)) {
            for (const v of value) {
              if (typeof v === 'string' && !v.includes('{{')) entities.add(v);
              else if (typeof v === 'string') hasTemplates = true;
            }
          }
        } else if (key === 'target' && typeof value === 'object' && value) {
          const target = value as Record<string, unknown>;
          if (typeof target.entity_id === 'string' && !target.entity_id.includes('{{')) {
            entities.add(target.entity_id);
          } else if (
            Array.isArray(target.entity_id) &&
            target.entity_id.every((v) => typeof v === 'string')
          ) {
            (target.entity_id as string[]).forEach((e) => entities.add(e));
          } else if (typeof target.entity_id === 'string') {
            hasTemplates = true;
          }
        } else {
          visit(value);
        }
      }
    }
  }

  visit(config.trigger);
  visit(config.condition);
  visit(config.action);

  return { entities, hasTemplates };
}
