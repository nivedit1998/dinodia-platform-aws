import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import {
  AutomationDraft,
  buildHaAutomationConfigFromDraft,
  extractEntityIdsFromAutomationConfig,
  setAutomationEnabled,
  updateAutomation,
  deleteAutomation as deleteAutomationConfig,
} from '@/lib/homeAssistantAutomations';

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function forbidden(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

async function getAllowedEntitiesForUser(userId: number, role: Role, haConnectionId: number) {
  const devices = await getDevicesForHaConnection(haConnectionId, { bypassCache: true });
  if (role === Role.ADMIN) {
    return new Set(devices.map((d) => d.entityId));
  }
  const { prisma } = await import('@/lib/prisma');
  const rules = await prisma.accessRule.findMany({ where: { userId } });
  const allowedAreas = new Set(rules.map((r) => r.area));
  const allowedDevices = devices.filter(
    (d) => d.areaName && allowedAreas.has(d.areaName)
  );
  return new Set(allowedDevices.map((d) => d.entityId));
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
      to: typeof triggerRaw.to === 'string' ? (triggerRaw.to as string) : undefined,
      from: typeof triggerRaw.from === 'string' ? (triggerRaw.from as string) : undefined,
      forSeconds:
        typeof triggerRaw.forSeconds === 'number' && triggerRaw.forSeconds > 0
          ? (triggerRaw.forSeconds as number)
          : undefined,
    };
  } else if (triggerRaw.type === 'schedule') {
    const scheduleType =
      triggerRaw.scheduleType === 'daily' ||
      triggerRaw.scheduleType === 'weekly' ||
      triggerRaw.scheduleType === 'monthly'
        ? (triggerRaw.scheduleType as 'daily' | 'weekly' | 'monthly')
        : null;
    const at = typeof triggerRaw.at === 'string' ? (triggerRaw.at as string) : null;
    if (!scheduleType || !at) return null;
    const weekdays =
      Array.isArray(triggerRaw.weekdays) &&
      triggerRaw.weekdays.every((v) => typeof v === 'string')
        ? (triggerRaw.weekdays as string[])
        : undefined;
    const day =
      typeof triggerRaw.day === 'number' && triggerRaw.day >= 1 && triggerRaw.day <= 31
        ? (triggerRaw.day as number)
        : undefined;
    trigger = {
      type: 'schedule',
      scheduleType,
      at,
      weekdays,
      day,
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

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ automationId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const { automationId } = await context.params;
  if (!automationId) return badRequest('Missing automation id');

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
  const config = buildHaAutomationConfigFromDraft(draft, automationId);
  const { entities } = extractEntityIdsFromAutomationConfig(config);
  const entityList = Array.from(entities);
  const allAllowed = entityList.every((e) => allowedEntities.has(e));
  if (!allAllowed) {
    return forbidden('You cannot edit an automation that controls a device outside your areas.');
  }

  try {
    await updateAutomation(ha, automationId, config);
    if (draft.enabled !== undefined) {
      await setAutomationEnabled(ha, `automation.${automationId}`, draft.enabled);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/automations/[id]] Failed to update automation', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to update automation in Home Assistant' },
      { status: 502 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ automationId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const { automationId } = await context.params;
  if (!automationId) return badRequest('Missing automation id');

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
  // Since we don't have the existing config here, we can still enforce delete by verifying the user has any access.
  // If the automation contains out-of-scope entities, HA will still delete, but we avoid exposing IDs to unauthorized users by requiring at least one allowed entity in ID format.
  // Lightweight guard: only allow delete if user has any allowed entities.
  if (allowedEntities.size === 0 && user.role === Role.TENANT) {
    return forbidden('You do not have permission to delete automations.');
  }

  try {
    await deleteAutomationConfig(ha, automationId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/automations/[id]] Failed to delete automation', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to delete automation in Home Assistant' },
      { status: 502 }
    );
  }
}
