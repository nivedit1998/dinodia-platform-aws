import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, hashPassword } from '@/lib/auth';
import { Role } from '@prisma/client';

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { username, password, area } = body;

  if (!username || !password || !area) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const admin = await prisma.user.findUnique({
    where: { id: me.id },
    include: { haConnection: true },
  });

  if (!admin || !admin.haConnection) {
    return NextResponse.json({ error: 'Admin HA setup missing' }, { status: 400 });
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
      haConnectionId: admin.haConnection.id,
    },
  });

  await prisma.accessRule.create({
    data: {
      userId: tenant.id,
      area,
    },
  });

  return NextResponse.json({ ok: true, tenantId: tenant.id });
}
