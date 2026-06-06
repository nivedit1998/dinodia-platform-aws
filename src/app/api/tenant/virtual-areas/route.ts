import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { normalizeDisplayText, normalizeLookupKey } from '@/lib/displayNormalization';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }
  const { user, haConnection } = await getUserWithHaConnection(me.id);
  const areas = await prisma.tenantVirtualArea.findMany({
    where: { tenantUserId: user.id, haConnectionId: haConnection.id },
    orderBy: [{ parentHaAreaName: 'asc' }, { displayName: 'asc' }],
  });
  return NextResponse.json({ ok: true, virtualAreas: areas });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }
  const { user, haConnection } = await getUserWithHaConnection(me.id);
  const body = await req.json().catch(() => ({}));
  const parentAreaName = normalizeDisplayText(body?.parentAreaName);
  const displayName = normalizeDisplayText(body?.displayName);
  if (!parentAreaName || !displayName) {
    return apiFailFromStatus(400, 'Please choose a parent area and enter a sub-area name.');
  }
  const allowedAreas = new Set(user.accessRules.map((rule) => rule.area));
  if (!allowedAreas.has(parentAreaName)) {
    return apiFailFromStatus(403, 'You are not allowed to add sub-areas under that area.');
  }
  const virtualArea = await prisma.tenantVirtualArea.upsert({
    where: {
      tenantUserId_haConnectionId_parentHaAreaName_displayKey: {
        tenantUserId: user.id,
        haConnectionId: haConnection.id,
        parentHaAreaName: parentAreaName,
        displayKey: normalizeLookupKey(displayName),
      },
    },
    update: { displayName, parentAreaDisplaySnapshot: parentAreaName },
    create: {
      tenantUserId: user.id,
      haConnectionId: haConnection.id,
      parentHaAreaName: parentAreaName,
      parentAreaDisplaySnapshot: parentAreaName,
      displayName,
      displayKey: normalizeLookupKey(displayName),
    },
  });
  return NextResponse.json({ ok: true, virtualArea });
}
