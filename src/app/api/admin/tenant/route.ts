import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, hashPassword } from '@/lib/auth';
import { Role } from '@prisma/client';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  try {
    await requireTrustedAdminDevice(req, me.id);
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }

  const body = await req.json();
  const { username, password, area, areas } = body;

  if (!username || !password) {
    return NextResponse.json({ error: 'Please enter a username and password.' }, { status: 400 });
  }

  const normalizedAreas = (() => {
    const candidateAreas: string[] = [];
    if (Array.isArray(areas)) {
      for (const entry of areas) {
        if (typeof entry === 'string') {
          candidateAreas.push(entry);
        }
      }
    }
    if (typeof area === 'string') {
      candidateAreas.push(area);
    }
    const cleaned = candidateAreas
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    return Array.from(new Set(cleaned));
  })();

  if (normalizedAreas.length === 0) {
    return NextResponse.json(
      { error: 'Add at least one room or area this tenant can access.' },
      { status: 400 }
    );
  }

  let userWithConnection: Awaited<ReturnType<typeof getUserWithHaConnection>>;
  try {
    userWithConnection = await getUserWithHaConnection(me.id);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'The Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  const { user, haConnection } = userWithConnection;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: 'That username is already in use. Try another one.' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const tenant = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: Role.TENANT,
      homeId: user.homeId,
      haConnectionId: haConnection.id,
    },
  });

  if (normalizedAreas.length > 0) {
    await prisma.accessRule.createMany({
      data: normalizedAreas.map((item) => ({
        userId: tenant.id,
        area: item,
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({ ok: true, tenantId: tenant.id });
}
