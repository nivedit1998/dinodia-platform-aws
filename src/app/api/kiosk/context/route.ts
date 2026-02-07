import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireKioskDeviceSession, toTrustedDeviceResponse } from '@/lib/deviceAuth';
import { logApiHit } from '@/lib/requestLog';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  logApiHit(req, '/api/kiosk/context');

  let user;
  try {
    ({ user } = await requireKioskDeviceSession(req));
  } catch (err) {
    const trusted = toTrustedDeviceResponse(err);
    if (trusted) return trusted;
    return NextResponse.json({ error: 'Unable to verify this device.' }, { status: 401 });
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
