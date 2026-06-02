import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, Role } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { canAccessProvision } from '@/lib/companyPortalAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ hubInstallId: string; roomId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || !canAccessProvision(me.role)) {
    return apiFailFromStatus(401, 'Installer access required.');
  }
  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }

  const { hubInstallId, roomId } = await context.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiFailFromStatus(400, 'Invalid request. Please try again.');
  }
  const obj = body as Record<string, unknown>;
  const newHaAreaName = typeof obj.haAreaName === 'string' ? obj.haAreaName.trim() : '';
  if (!newHaAreaName) {
    return apiFailFromStatus(400, 'Home Assistant area name is required.');
  }

  const room = await prisma.room.findFirst({
    where: { id: roomId, hubInstallId },
    select: { id: true, haAreaName: true, displayName: true },
  });
  if (!room) return apiFailFromStatus(404, 'Room not found.');

  const hub = await prisma.hubInstall.findUnique({ where: { id: hubInstallId }, select: { homeId: true } });
  const homeId = hub?.homeId ?? null;

  const oldArea = room.haAreaName;
  if (oldArea.trim() === newHaAreaName.trim()) {
    return NextResponse.json({ ok: true, updated: false });
  }

  await prisma.$transaction(async (tx) => {
    await tx.room.update({
      where: { id: room.id },
      data: { haAreaName: newHaAreaName },
    });

    if (homeId) {
      const tenantIds = await tx.user.findMany({
        where: { homeId, role: Role.TENANT },
        select: { id: true },
      });
      const ids = tenantIds.map((t) => t.id);
      if (ids.length > 0) {
        await tx.accessRule.updateMany({
          where: { userId: { in: ids }, area: oldArea },
          data: { area: newHaAreaName },
        });
      }
    }
  });

  if (homeId) {
    await prisma.auditEvent.create({
      data: {
        type: AuditEventType.ROOM_HA_AREA_RESYNCED,
        homeId,
        actorUserId: me.id,
        metadata: {
          roomId: room.id,
          roomDisplayName: room.displayName,
          oldHaAreaName: oldArea,
          newHaAreaName,
        },
      },
    });
  }

  return NextResponse.json({ ok: true, updated: true });
}
