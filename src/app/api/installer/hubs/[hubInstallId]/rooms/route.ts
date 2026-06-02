import { NextRequest, NextResponse } from 'next/server';
import { RoomStatus } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { canAccessProvision } from '@/lib/companyPortalAccess';
import {
  buildRoomQrPayload,
  decryptRoomQrSecret,
  encryptRoomQrSecret,
  generateRoomQrSecret,
  hashRoomQrSecret,
} from '@/lib/roomQr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ hubInstallId: string }> }) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || !canAccessProvision(me.role)) {
    return apiFailFromStatus(401, 'Installer access required.');
  }
  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }

  const { hubInstallId } = await context.params;

  const hub = await prisma.hubInstall.findUnique({ where: { id: hubInstallId }, select: { id: true } });
  if (!hub) return apiFailFromStatus(404, 'Hub not found.');

  const rooms = await prisma.room.findMany({
    where: { hubInstallId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      displayName: true,
      haAreaName: true,
      haAreaNameOriginal: true,
      qrKeyVersion: true,
      qrSecretCiphertext: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const shaped = rooms.map((room) => {
    const secret = decryptRoomQrSecret(room.qrSecretCiphertext);
    return {
      id: room.id,
      displayName: room.displayName,
      haAreaName: room.haAreaName,
      haAreaNameOriginal: room.haAreaNameOriginal,
      qrKeyVersion: room.qrKeyVersion,
      status: room.status,
      qrPayload: buildRoomQrPayload({ roomId: room.id, token: secret }),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  });

  return NextResponse.json({ ok: true, rooms: shaped });
}

export async function POST(req: NextRequest, context: { params: Promise<{ hubInstallId: string }> }) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || !canAccessProvision(me.role)) {
    return apiFailFromStatus(401, 'Installer access required.');
  }
  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }

  const { hubInstallId } = await context.params;
  const hub = await prisma.hubInstall.findUnique({ where: { id: hubInstallId }, select: { id: true } });
  if (!hub) return apiFailFromStatus(404, 'Hub not found.');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return apiFailFromStatus(400, 'Invalid request. Please try again.');
  }
  const obj = body as Record<string, unknown>;
  const displayName = typeof obj.displayName === 'string' ? obj.displayName.trim() : '';
  const haAreaName = typeof obj.haAreaName === 'string' ? obj.haAreaName.trim() : '';
  if (!displayName || !haAreaName) {
    return apiFailFromStatus(400, 'Room name and Home Assistant area name are required.');
  }

  const secret = generateRoomQrSecret();
  const room = await prisma.room.create({
    data: {
      hubInstallId,
      displayName,
      haAreaName,
      haAreaNameOriginal: haAreaName,
      qrKeyVersion: 1,
      qrSecretHash: hashRoomQrSecret(secret),
      qrSecretCiphertext: encryptRoomQrSecret(secret),
      status: RoomStatus.ACTIVE,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, roomId: room.id });
}
