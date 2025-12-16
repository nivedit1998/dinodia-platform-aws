import { NextRequest, NextResponse } from 'next/server';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import {
  DEVICE_CONTROL_NUMERIC_COMMANDS,
  executeDeviceCommand,
} from '@/lib/deviceControl';

export async function POST(req: NextRequest) {
  const authUser = await resolveAlexaAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { entityId, command, value } = body as {
    entityId?: string;
    command?: string;
    value?: number;
  };

  if (!entityId || !command) {
    return NextResponse.json({ error: 'Missing entityId or command' }, { status: 400 });
  }

  if (DEVICE_CONTROL_NUMERIC_COMMANDS.has(command) && typeof value !== 'number') {
    return NextResponse.json({ error: 'Command requires numeric value' }, { status: 400 });
  }

  try {
    const { haConnection } = await getUserWithHaConnection(authUser.id);
    const effectiveHa = resolveHaCloudFirst(haConnection);
    await executeDeviceCommand(effectiveHa, entityId, command, value, { source: 'alexa' });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/alexa/device-control] error', err);
    const message = err instanceof Error ? err.message : 'Control failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
