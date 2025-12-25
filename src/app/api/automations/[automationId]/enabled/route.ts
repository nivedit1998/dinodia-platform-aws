import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { setAutomationEnabled } from '@/lib/homeAssistantAutomations';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';

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

async function guardAdminDevice(req: NextRequest, user: { id: number; role: Role }) {
  if (user.role !== Role.ADMIN) return null;
  try {
    await requireTrustedAdminDevice(req, user.id);
    return null;
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ automationId: string }> }
) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const deviceError = await guardAdminDevice(req, user as { id: number; role: Role });
  if (deviceError) return deviceError;

  const { automationId } = await context.params;
  if (!automationId) return badRequest('Missing automation id');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).enabled !== 'boolean') {
    return badRequest('enabled must be provided as boolean');
  }
  const enabled = (body as Record<string, unknown>).enabled as boolean;

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
  if (allowedEntities.size === 0 && user.role === Role.TENANT) {
    return forbidden('You do not have permission to manage automations.');
  }

  try {
    await setAutomationEnabled(ha, `automation.${automationId}`, enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/automations/[id]/enabled] Failed to toggle automation', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to update automation state in Home Assistant' },
      { status: 502 }
    );
  }
}
