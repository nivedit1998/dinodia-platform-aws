import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { checkRateLimit } from '@/lib/rateLimit';
import {
  DEVICE_CONTROL_NUMERIC_COMMANDS,
  executeDeviceCommand,
} from '@/lib/deviceControl';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { Role } from '@prisma/client';
import { bumpDevicesVersion } from '@/lib/devicesVersion';

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (me.role !== Role.TENANT) {
    return NextResponse.json(
      { ok: false, error: 'Device control is available to tenants only.' },
      { status: 403 }
    );
  }

  const allowed = await checkRateLimit(`device-control:${me.id}`, {
    maxRequests: 30,
    windowMs: 10_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "You've sent a lot of commands at once. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const { entityId, command, value } = body as {
    entityId?: string;
    command?: string;
    value?: number;
  };

  if (!entityId || !command) {
    return NextResponse.json(
      { ok: false, error: 'Missing entityId or command' },
      { status: 400 }
    );
  }

  if (DEVICE_CONTROL_NUMERIC_COMMANDS.has(command) && typeof value !== 'number') {
    return NextResponse.json(
      { ok: false, error: 'Command requires numeric value' },
      { status: 400 }
    );
  }

  try {
    const { user, haConnection } = await getUserWithHaConnection(me.id);
    const effectiveHa = resolveHaCloudFirst(haConnection);

    if (user.role === Role.TENANT) {
      const allowedAreas = new Set(user.accessRules.map((r) => r.area));
      const devices = await getDevicesForHaConnection(haConnection.id, { bypassCache: true });
      const allowedEntityIds = new Set(
        devices
          .filter((d) => d.areaName && allowedAreas.has(d.areaName))
          .map((d) => d.entityId)
      );
      if (!allowedEntityIds.has(entityId)) {
        return NextResponse.json(
          { ok: false, error: 'You are not allowed to control that device.' },
          { status: 403 }
        );
      }
    }

    await executeDeviceCommand(effectiveHa, entityId, command, value, {
      source: 'app',
      userId: user.id,
      haConnectionId: haConnection.id,
    });
    await bumpDevicesVersion(haConnection.id).catch((err) =>
      console.warn('[api/device-control] Failed to bump devicesVersion', { haConnectionId: haConnection.id, err })
    );
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('Device control error', err);
    const raw = err instanceof Error ? err.message : 'Control failed';
    const message =
      raw && raw.toLowerCase().includes('ha')
        ? "We couldn't reach your Dinodia Hub for that action. Please try again in a moment."
        : raw || "We couldn't complete that action. Please try again.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
