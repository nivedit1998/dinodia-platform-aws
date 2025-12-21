import { randomUUID } from 'crypto';
import { callHaService, callHomeAssistantAPI, HaConnectionLike } from '@/lib/homeAssistant';
import { HaWsClient } from '@/lib/haWebSocket';

export type HaAutomationConfig = {
  id: string;
  alias: string;
  description?: string;
  mode?: string;
  trigger?: unknown[];
  condition?: unknown[];
  action?: unknown[];
  // Some HA versions expose enabled/disabled flag; keep it loose.
  enabled?: boolean;
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
    platform: 'state',
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
  const baseTrigger = { platform: 'time', at };
  const conditions: unknown[] = [];

  if (trigger.scheduleType === 'weekly') {
    const weekdays =
      trigger.weekdays && trigger.weekdays.length > 0
        ? trigger.weekdays
        : ['mon'];
    conditions.push({ condition: 'time', weekday: weekdays });
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
  const trigger =
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

  const action = [buildAction(draft.action)];

  return {
    id: automationId || `dinodia_${randomUUID()}`,
    alias: draft.alias,
    description: draft.description || 'Created via Dinodia',
    mode: draft.mode || 'single',
    trigger,
    condition: conditions,
    action,
    enabled: draft.enabled ?? true,
  };
}

async function listViaRest(ha: HaConnectionLike): Promise<HaAutomationConfig[]> {
  return await callHomeAssistantAPI<HaAutomationConfig[]>(ha, '/api/config/automation/config');
}

async function listViaWs(ha: HaConnectionLike): Promise<HaAutomationConfig[]> {
  const client = await HaWsClient.connect(ha);
  try {
    const result = await client.call<HaAutomationConfig[] | { automations?: HaAutomationConfig[] }>(
      'automation/config/list'
    );
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.automations)) return result.automations;
    throw new Error('Unexpected HA automation list payload');
  } finally {
    client.close();
  }
}

export async function listAutomationConfigs(ha: HaConnectionLike): Promise<HaAutomationConfig[]> {
  try {
    return await listViaRest(ha);
  } catch (err) {
    console.warn('[homeAssistantAutomations] REST list failed, trying WS', err);
    return await listViaWs(ha);
  }
}

export async function createAutomation(ha: HaConnectionLike, config: HaAutomationConfig) {
  const client = await HaWsClient.connect(ha);
  try {
    return await client.call<{ id: string }>('automation/config/create', config);
  } finally {
    client.close();
  }
}

export async function updateAutomation(
  ha: HaConnectionLike,
  automationId: string,
  config: HaAutomationConfig
) {
  const client = await HaWsClient.connect(ha);
  try {
    return await client.call('automation/config/update', {
      automation_id: automationId,
      ...config,
    });
  } finally {
    client.close();
  }
}

export async function deleteAutomation(ha: HaConnectionLike, automationId: string) {
  const client = await HaWsClient.connect(ha);
  try {
    return await client.call('automation/config/delete', { automation_id: automationId });
  } finally {
    client.close();
  }
}

export async function setAutomationEnabled(
  ha: HaConnectionLike,
  automationId: string,
  enabled: boolean
) {
  // Prefer service toggle; config updates can also set enabled on some versions.
  const service = enabled ? 'turn_on' : 'turn_off';
  await callHaService(ha, 'automation', service, { entity_id: automationId });
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
