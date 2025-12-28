import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { ensureActiveDevice } from '@/lib/deviceRegistry';
import { readDeviceHeaders } from '@/lib/deviceAuth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  const { deviceId } = readDeviceHeaders(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'Device id is required.' }, { status: 400 });
  }

  try {
    await ensureActiveDevice(deviceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'This device is blocked.';
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      username: true,
      role: true,
      homeId: true,
      haConnection: {
        select: {
          id: true,
          cloudUrl: true,
          ownerId: true,
        },
      },
      accessRules: {
        select: { area: true },
      },
    },
  });

  if (!fullUser || !fullUser.haConnection) {
    return NextResponse.json(
      { error: 'Dinodia Hub connection is not configured for this account.' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    user: {
      id: fullUser.id,
      username: fullUser.username,
      role: fullUser.role,
      homeId: fullUser.homeId,
    },
    haConnection: {
      id: fullUser.haConnection.id,
      ownerId: fullUser.haConnection.ownerId,
      cloudEnabled: Boolean(fullUser.haConnection.cloudUrl?.trim()),
    },
    accessRules: fullUser.accessRules ?? [],
  });
}
