import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { checkRateLimit } from '@/lib/rateLimit';
import {
  DEVICE_CONTROL_NUMERIC_COMMANDS,
  executeDeviceCommand,
} from '@/lib/deviceControl';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const allowed = checkRateLimit(`device-control:${user.id}`, {
    maxRequests: 30,
    windowMs: 10_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: 'You’ve sent a lot of commands at once. Please wait a moment and try again.' },
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
    const { haConnection } = await getUserWithHaConnection(user.id);
    const effectiveHa = resolveHaCloudFirst(haConnection);
    await executeDeviceCommand(effectiveHa, entityId, command, value, {
      source: 'app',
      userId: user.id,
      haConnectionId: haConnection.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('Device control error', err);
    const raw = err instanceof Error ? err.message : 'Control failed';
    const message =
      raw && raw.toLowerCase().includes('ha')
        ? 'We couldn’t reach your Dinodia Hub for that action. Please try again in a moment.'
        : raw || 'We couldn’t complete that action. Please try again.';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
