import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, hashPassword } from '@/lib/auth';
import { Role } from '@prisma/client';
import { getUserWithHaConnection } from '@/lib/haConnection';

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { username, password, area, areas } = body;

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
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
      { error: 'At least one area is required for the tenant' },
      { status: 400 }
    );
  }

  let haConnection;
  try {
    ({ haConnection } = await getUserWithHaConnection(me.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Admin HA setup missing' },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: 'Username already exists' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const tenant = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: Role.TENANT,
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
