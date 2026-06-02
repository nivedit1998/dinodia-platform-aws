import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, Role } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { canAccessHomeSupport } from '@/lib/companyPortalAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseHomeId(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ homeId: string; roomId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || !canAccessHomeSupport(me.role)) {
    return apiFailFromStatus(401, 'Installer access required.');
  }
  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }

  const { homeId: rawHomeId, roomId } = await context.params;
  const homeId = parseHomeId(rawHomeId);
  if (!homeId) return apiFailFromStatus(400, 'Invalid home id.');

  const hub = await prisma.home.findUnique({
    where: { id: homeId },
    select: { hubInstall: { select: { id: true } } },
  });
  const hubInstallId = hub?.hubInstall?.id;
  if (!hubInstallId) return apiFailFromStatus(404, 'Home not found.');

  const room = await prisma.room.findFirst({
    where: { id: roomId, hubInstallId },
    select: { id: true, displayName: true, haAreaName: true },
  });
  if (!room) return apiFailFromStatus(404, 'Room not found.');

  const revoked = await prisma.$transaction(async (tx) => {
    const tenantIds = await tx.user.findMany({
      where: { homeId, role: Role.TENANT },
      select: { id: true },
    });
    const ids = tenantIds.map((t) => t.id);
    const accessRules = ids.length
      ? await tx.accessRule.deleteMany({ where: { userId: { in: ids }, area: room.haAreaName } })
      : { count: 0 };
    await tx.room.delete({ where: { id: room.id } });
    return { accessRulesDeleted: accessRules.count };
  });

  await prisma.auditEvent.create({
    data: {
      type: AuditEventType.ROOM_HA_AREA_RESYNCED,
      homeId,
      actorUserId: me.id,
      metadata: {
        action: 'ROOM_DELETED',
        roomId: room.id,
        roomDisplayName: room.displayName,
        haAreaName: room.haAreaName,
        accessRulesDeleted: revoked.accessRulesDeleted,
      },
    },
  });

  return NextResponse.json({ ok: true, accessRulesDeleted: revoked.accessRulesDeleted });
}
