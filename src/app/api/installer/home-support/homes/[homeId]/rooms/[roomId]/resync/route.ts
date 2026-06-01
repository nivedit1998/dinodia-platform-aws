import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, Role } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseHomeId(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ homeId: string; roomId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return apiFailFromStatus(401, 'Installer access required.');
  }
  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }

  const { homeId: rawHomeId, roomId } = await context.params;
  const homeId = parseHomeId(rawHomeId);
  if (!homeId) return apiFailFromStatus(400, 'Invalid home id.');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiFailFromStatus(400, 'Invalid request. Please try again.');
  }
  const obj = body as Record<string, unknown>;
  const newHaAreaName = typeof obj.haAreaName === 'string' ? obj.haAreaName.trim() : '';
  if (!newHaAreaName) {
    return apiFailFromStatus(400, 'Home Assistant area name is required.');
  }

  const hub = await prisma.home.findUnique({
    where: { id: homeId },
    select: { hubInstall: { select: { id: true } } },
  });
  const hubInstallId = hub?.hubInstall?.id;
  if (!hubInstallId) return apiFailFromStatus(404, 'Home not found.');

  const room = await prisma.room.findFirst({
    where: { id: roomId, hubInstallId },
    select: { id: true, haAreaName: true, displayName: true },
  });
  if (!room) return apiFailFromStatus(404, 'Room not found.');

  const oldArea = room.haAreaName;
  if (oldArea.trim() === newHaAreaName.trim()) {
    return NextResponse.json({ ok: true, updated: false });
  }

  await prisma.$transaction(async (tx) => {
    await tx.room.update({
      where: { id: room.id },
      data: { haAreaName: newHaAreaName },
    });

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
  });

  await prisma.auditEvent.create({
    data: {
      type: AuditEventType.ROOM_HA_AREA_RESYNCED,
      homeId,
      actorUserId: me.id,
      metadata: { roomId: room.id, roomDisplayName: room.displayName, oldHaAreaName: oldArea, newHaAreaName },
    },
  });

  return NextResponse.json({ ok: true, updated: true });
}

