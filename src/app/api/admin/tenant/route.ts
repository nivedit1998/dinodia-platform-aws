import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest, hashPassword } from '@/lib/auth';
import { Role } from '@prisma/client';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  try {
    await requireTrustedAdminDevice(req, me.id);
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiFailFromStatus(400, 'Invalid request. Please try again.');
  }
  const { username, password, area, areas } = body;

  if (!username || !password) {
    return apiFailFromStatus(400, 'Please enter a username and password.');
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
    return apiFailFromStatus(400, 'Add at least one room or area this tenant can access.');
  }

  let userWithConnection: Awaited<ReturnType<typeof getUserWithHaConnection>>;
  try {
    userWithConnection = await getUserWithHaConnection(me.id);
  } catch {
    return apiFailFromStatus(400, 'Dinodia Hub connection isn’t set up yet for this home.');
  }

  const { user, haConnection } = userWithConnection;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return apiFailFromStatus(400, 'That username is already in use. Try another one.');
  }

  const passwordHash = await hashPassword(password);

  const tenant = await prisma.user.create({
    data: {
      username,
      passwordHash,
      mustChangePassword:
        (process.env.TENANT_FIRST_LOGIN_PASSWORD_CHANGE_ENABLED ?? '').toLowerCase() === 'true',
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

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  try {
    await requireTrustedAdminDevice(req, me.id);
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }

  const admin = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, homeId: true },
  });

  if (!admin) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  const tenants = await prisma.user.findMany({
    where: { homeId: admin.homeId, role: Role.TENANT },
    select: {
      id: true,
      username: true,
      accessRules: { select: { area: true } },
    },
    orderBy: { username: 'asc' },
  });

  const shaped = tenants.map((tenant) => ({
    id: tenant.id,
    username: tenant.username,
    areas: tenant.accessRules.map((rule) => rule.area),
  }));

  return NextResponse.json({ ok: true, tenants: shaped });
}
