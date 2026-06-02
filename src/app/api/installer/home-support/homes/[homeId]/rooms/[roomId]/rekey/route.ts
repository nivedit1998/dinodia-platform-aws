import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, RoomStatus } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { canAccessHomeSupport } from '@/lib/companyPortalAccess';
import { encryptRoomQrSecret, generateRoomQrSecret, hashRoomQrSecret } from '@/lib/roomQr';

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
    select: { id: true, qrKeyVersion: true, displayName: true },
  });
  if (!room) return apiFailFromStatus(404, 'Room not found.');

  const secret = generateRoomQrSecret();
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: {
      qrKeyVersion: room.qrKeyVersion + 1,
      qrSecretHash: hashRoomQrSecret(secret),
      qrSecretCiphertext: encryptRoomQrSecret(secret),
      status: RoomStatus.REKEYED,
    },
    select: { qrKeyVersion: true },
  });

  await prisma.auditEvent.create({
    data: {
      type: AuditEventType.ROOM_QR_REKEYED,
      homeId,
      actorUserId: me.id,
      metadata: { roomId: room.id, roomDisplayName: room.displayName, newKeyVersion: updated.qrKeyVersion },
    },
  });

  return NextResponse.json({ ok: true, qrKeyVersion: updated.qrKeyVersion });
}
