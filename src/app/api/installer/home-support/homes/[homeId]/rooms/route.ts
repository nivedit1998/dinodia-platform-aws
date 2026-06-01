import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, Prisma, Role, RoomStatus } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import {
  buildRoomQrPayload,
  decryptRoomQrSecret,
  encryptRoomQrSecret,
  generateRoomQrSecret,
  hashRoomQrSecret,
} from '@/lib/roomQr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseHomeId(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

async function resolveInstaller(req: NextRequest): Promise<{ userId: number } | NextResponse> {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return apiFailFromStatus(401, 'Installer access required.');
  }
  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }
  return { userId: me.id };
}

async function resolveHomeHubInstallId(homeId: number): Promise<string | null> {
  const home = await prisma.home.findUnique({
    where: { id: homeId },
    select: { hubInstall: { select: { id: true } } },
  });
  return home?.hubInstall?.id ?? null;
}

export async function GET(req: NextRequest, context: { params: Promise<{ homeId: string }> }) {
  const resolved = await resolveInstaller(req);
  if (resolved instanceof NextResponse) return resolved;

  const { homeId: rawHomeId } = await context.params;
  const homeId = parseHomeId(rawHomeId);
  if (!homeId) return apiFailFromStatus(400, 'Invalid home id.');

  const hubInstallId = await resolveHomeHubInstallId(homeId);
  if (!hubInstallId) return apiFailFromStatus(404, 'Home not found.');

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

export async function POST(req: NextRequest, context: { params: Promise<{ homeId: string }> }) {
  const resolved = await resolveInstaller(req);
  if (resolved instanceof NextResponse) return resolved;

  const { homeId: rawHomeId } = await context.params;
  const homeId = parseHomeId(rawHomeId);
  if (!homeId) return apiFailFromStatus(400, 'Invalid home id.');

  const hubInstallId = await resolveHomeHubInstallId(homeId);
  if (!hubInstallId) return apiFailFromStatus(404, 'Home not found.');

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
  try {
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

    await prisma.auditEvent.create({
      data: {
        type: AuditEventType.ROOM_QR_REKEYED,
        homeId,
        actorUserId: resolved.userId,
        metadata: { action: 'ROOM_CREATED', roomId: room.id, displayName, haAreaName },
      },
    });

    return NextResponse.json({ ok: true, roomId: room.id });
  } catch (err) {
    const prismaError = err as Prisma.PrismaClientKnownRequestError;
    if (prismaError?.code === 'P2002') {
      return apiFailFromStatus(409, 'A room already exists for that Home Assistant area name.');
    }
    return apiFailFromStatus(500, 'Unable to create room right now.');
  }
}

