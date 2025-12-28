import { NextRequest, NextResponse } from 'next/server';
import { DeviceStatus } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { markDeviceStatus } from '@/lib/deviceRegistry';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  const label = typeof body?.label === 'string' ? body.label.trim() : undefined;

  if (!deviceId) {
    return NextResponse.json({ error: 'Device id is required.' }, { status: 400 });
  }

  await markDeviceStatus(deviceId, DeviceStatus.ACTIVE, label);
  await prisma.trustedDevice.updateMany({
    where: { userId: user.id, deviceId },
    data: { revokedAt: null },
  });

  return NextResponse.json({ ok: true });
}
