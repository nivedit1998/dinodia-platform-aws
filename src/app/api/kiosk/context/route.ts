import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireKioskDeviceSession } from '@/lib/deviceAuth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { user } = await requireKioskDeviceSession(req);

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
