import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import {
  AutomationDraft,
  buildHaAutomationConfigFromDraft,
  createAutomation,
  extractEntityIdsFromAutomationConfig,
  listAutomationConfigs,
  setAutomationEnabled,
} from '@/lib/homeAssistantAutomations';
import type { DeviceCommandId } from '@/lib/deviceCapabilities';

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function forbidden(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

function parseDraft(body: unknown): AutomationDraft | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const alias = typeof obj.alias === 'string' ? obj.alias.trim() : '';
  if (!alias) return null;
  const description = typeof obj.description === 'string' ? obj.description : undefined;
  const mode =
    obj.mode === 'single' ||
    obj.mode === 'restart' ||
    obj.mode === 'queued' ||
    obj.mode === 'parallel'
      ? obj.mode
      : undefined;
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : undefined;

  const triggerRaw = obj.trigger as Record<string, unknown> | undefined;
  const actionRaw = obj.action as Record<string, unknown> | undefined;
  if (!triggerRaw || !actionRaw) return null;

  let trigger: AutomationDraft['trigger'] | null = null;
  if (triggerRaw.type === 'state') {
    const entityId =
      typeof triggerRaw.entityId === 'string' ? (triggerRaw.entityId as string) : null;
    if (!entityId) return null;
    trigger = {
      type: 'state',
      entityId,
      to:
        typeof triggerRaw.to === 'string' || typeof triggerRaw.to === 'number'
          ? (triggerRaw.to as string | number)
          : undefined,
    };
  } else if (triggerRaw.type === 'device') {
    const entityId =
      typeof triggerRaw.entityId === 'string' ? (triggerRaw.entityId as string) : null;
    const mode =
      triggerRaw.mode === 'state_equals' ||
      triggerRaw.mode === 'attribute_delta' ||
      triggerRaw.mode === 'position_equals'
        ? (triggerRaw.mode as 'state_equals' | 'attribute_delta' | 'position_equals')
        : null;
    if (!entityId || !mode) return null;
    trigger = {
      type: 'device',
      entityId,
      mode,
      to:
        typeof triggerRaw.to === 'string' || typeof triggerRaw.to === 'number'
          ? (triggerRaw.to as string | number)
          : undefined,
      direction:
        triggerRaw.direction === 'increased' || triggerRaw.direction === 'decreased'
          ? (triggerRaw.direction as 'increased' | 'decreased')
          : undefined,
      attribute: typeof triggerRaw.attribute === 'string' ? triggerRaw.attribute : undefined,
    };
  } else if (triggerRaw.type === 'schedule') {
    const scheduleType =
      triggerRaw.scheduleType === 'weekly'
        ? (triggerRaw.scheduleType as 'weekly')
        : null;
    const at = typeof triggerRaw.at === 'string' ? (triggerRaw.at as string) : null;
    if (!scheduleType || !at) return null;
    const weekdays =
      Array.isArray(triggerRaw.weekdays) &&
      triggerRaw.weekdays.every((v) => typeof v === 'string')
        ? (triggerRaw.weekdays as string[])
        : [];
    trigger = {
      type: 'schedule',
      scheduleType,
      at,
      weekdays,
    };
  }

  if (!trigger) return null;

  let action: AutomationDraft['action'] | null = null;
  if (
    actionRaw.type === 'toggle' ||
    actionRaw.type === 'turn_on' ||
    actionRaw.type === 'turn_off'
  ) {
    const entityId =
      typeof actionRaw.entityId === 'string' ? (actionRaw.entityId as string) : null;
    if (!entityId) return null;
    action = { type: actionRaw.type, entityId };
  } else if (actionRaw.type === 'set_brightness') {
    const entityId =
      typeof actionRaw.entityId === 'string' ? (actionRaw.entityId as string) : null;
    if (!entityId || typeof actionRaw.value !== 'number') return null;
    action = { type: 'set_brightness', entityId, value: actionRaw.value };
  } else if (actionRaw.type === 'set_temperature') {
    const entityId =
      typeof actionRaw.entityId === 'string' ? (actionRaw.entityId as string) : null;
    if (!entityId || typeof actionRaw.value !== 'number') return null;
    action = { type: 'set_temperature', entityId, value: actionRaw.value };
  } else if (actionRaw.type === 'set_cover_position') {
    const entityId =
      typeof actionRaw.entityId === 'string' ? (actionRaw.entityId as string) : null;
    if (!entityId || typeof actionRaw.value !== 'number') return null;
    action = { type: 'set_cover_position', entityId, value: actionRaw.value };
  } else if (actionRaw.type === 'device_command') {
    const entityId =
      typeof actionRaw.entityId === 'string' ? (actionRaw.entityId as string) : null;
    const rawCommand = typeof actionRaw.command === 'string' ? actionRaw.command : null;
    const allowedCommands: DeviceCommandId[] = [
      'light/toggle',
      'light/set_brightness',
      'blind/set_position',
      'media/play_pause',
      'media/next',
      'media/previous',
      'media/volume_set',
      'media/volume_up',
      'media/volume_down',
      'tv/toggle_power',
      'speaker/toggle_power',
      'boiler/temp_up',
      'boiler/temp_down',
      'boiler/set_temperature',
    ];
    const command =
      rawCommand && (allowedCommands as readonly string[]).includes(rawCommand)
        ? (rawCommand as DeviceCommandId)
        : null;
    const value =
      typeof actionRaw.value === 'number' || typeof actionRaw.value === 'string'
        ? (actionRaw.value as number | string)
        : undefined;
    if (!entityId || !command) return null;
    action = { type: 'device_command', entityId, command, value };
  }

  if (!action) return null;

  return {
    alias,
    description,
    mode,
    enabled,
    trigger,
    action,
  };
}

async function getAllowedEntitiesForUser(userId: number, role: Role, haConnectionId: number) {
  const devices = await getDevicesForHaConnection(haConnectionId, { bypassCache: true });
  if (role === Role.ADMIN) {
    return new Set(devices.map((d) => d.entityId));
  }
  // Tenant: restrict to areas in accessRules
  const { prisma } = await import('@/lib/prisma');
  const rules = await prisma.accessRule.findMany({ where: { userId } });
  const allowedAreas = new Set(rules.map((r) => r.area));
  const allowedDevices = devices.filter(
    (d) => d.areaName && allowedAreas.has(d.areaName)
  );
  return new Set(allowedDevices.map((d) => d.entityId));
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const entityFilter = req.nextUrl.searchParams.get('entityId');

  let haConnectionId: number;
  let ha;
  try {
    const result = await getUserWithHaConnection(user.id);
    haConnectionId = result.haConnection.id;
    ha = resolveHaCloudFirst(result.haConnection);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  const allowedEntities = await getAllowedEntitiesForUser(user.id, user.role as Role, haConnectionId);

  let configs;
  try {
    configs = await listAutomationConfigs(ha);
  } catch (err) {
    console.error('[api/automations] Failed to list automations', err);
    return NextResponse.json({ ok: false, error: 'Failed to fetch automations from Home Assistant' }, { status: 502 });
  }

  const shaped = configs
    .map((config) => {
      const { triggerEntities, conditionEntities, actionEntities, hasTemplates } =
        extractEntityIdsFromAutomationConfig(config);
      const actionList = Array.from(actionEntities);
      const allEntities = new Set<string>([
        ...triggerEntities,
        ...conditionEntities,
        ...actionEntities,
      ]);
      const allowed = Array.from(allEntities).every((e) => allowedEntities.has(e));
      const matchesFilter =
        !entityFilter ||
        actionList.includes(entityFilter) ||
        (actionList.length === 0 && hasTemplates);
      return {
        id: config.id,
        entityId: config.entityId ?? `automation.${config.id}`,
        alias: config.alias,
        description: config.description ?? '',
        mode: config.mode ?? 'single',
        entities: actionList,
        hasTemplates,
        canEdit: allowed && !hasTemplates,
        raw: config,
        matchesFilter,
        enabled: config.enabled ?? true,
      };
    })
    .filter((c) => (entityFilter ? c.matchesFilter : true));

  return NextResponse.json({ ok: true, automations: shaped });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const draft = parseDraft(await req.json().catch(() => null));
  if (!draft) {
    return badRequest('Invalid automation payload');
  }

  let haConnectionId: number;
  let ha;
  try {
    const result = await getUserWithHaConnection(user.id);
    haConnectionId = result.haConnection.id;
    ha = resolveHaCloudFirst(result.haConnection);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  const allowedEntities = await getAllowedEntitiesForUser(user.id, user.role as Role, haConnectionId);
  const config = buildHaAutomationConfigFromDraft(draft);
  const { triggerEntities, conditionEntities, actionEntities } =
    extractEntityIdsFromAutomationConfig(config);
  const combined = new Set<string>([
    ...triggerEntities,
    ...conditionEntities,
    ...actionEntities,
  ]);
  const allAllowed = Array.from(combined).every((e) => allowedEntities.has(e));
  if (!allAllowed) {
    return forbidden('You cannot create an automation that controls a device outside your areas.');
  }

  try {
    const result = await createAutomation(ha, config);
    if (draft.enabled !== undefined) {
      await setAutomationEnabled(ha, `automation.${config.id}`, draft.enabled);
    }
    return NextResponse.json({ ok: true, id: (result as { id?: string })?.id ?? config.id });
  } catch (err) {
    console.error('[api/automations] Failed to create automation', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to create automation in Home Assistant' },
      { status: 502 }
    );
  }
}
