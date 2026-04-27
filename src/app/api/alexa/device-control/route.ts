import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import {
  DEVICE_CONTROL_NUMERIC_COMMANDS,
  executeDeviceCommand,
} from '@/lib/deviceControl';
import { EntityAccessError, assertTenantEntityAccess, parseEntityId } from '@/lib/entityAccess';
import { Role } from '@prisma/client';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const authUser = await resolveAlexaAuthUser(req);
  if (!authUser) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  if (authUser.role !== Role.TENANT) {
    return apiFailFromStatus(403, 'Alexa is available to tenant accounts only.');
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiFailFromStatus(400, 'Invalid body');
  }

  let entityId: string;
  let command: string;
  let value: number | undefined;
  try {
    const parsed = parseEntityId((body as Record<string, unknown> | null)?.entityId);
    entityId = parsed.entityId;
    command = (body as Record<string, unknown> | null)?.command as string;
    value = (body as Record<string, unknown> | null)?.value as number | undefined;
  } catch (err) {
    const status = err instanceof EntityAccessError ? err.status : 400;
    const message = err instanceof Error ? err.message : 'Invalid body';
    return apiFailFromStatus(status, message);
  }

  if (!entityId || !command) {
    return apiFailFromStatus(400, 'Missing entityId or command');
  }

  const allowed = await checkRateLimit(`alexa-device-control:${authUser.id}`, {
    maxRequests: 30,
    windowMs: 10_000,
  });
  if (!allowed) {
    return apiFailFromStatus(429, 'Too many requests. Please wait a moment and try again.');
  }

  if (DEVICE_CONTROL_NUMERIC_COMMANDS.has(command) && typeof value !== 'number') {
    return apiFailFromStatus(400, 'Command requires numeric value');
  }

  try {
    const { haConnection, user } = await getUserWithHaConnection(authUser.id);

    try {
      await assertTenantEntityAccess({
        user: { id: user.id, role: user.role as Role },
        accessRules: user.accessRules ?? [],
        haConnectionId: haConnection.id,
        entityId,
        options: { bypassCache: true, notFoundStatus: 404 },
      });
    } catch (err) {
      if (err instanceof EntityAccessError) {
        return apiFailFromStatus(err.status, err.message);
      }
      throw err;
    }

    const effectiveHa = resolveHaCloudFirst(haConnection);
    await executeDeviceCommand(effectiveHa, entityId, command, value, {
      source: 'alexa',
      userId: authUser.id,
      haConnectionId: haConnection.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/alexa/device-control] error', err);
    return apiFailFromStatus(500, 'Dinodia Hub unavailable. Please refresh and try again.');
  }
}
