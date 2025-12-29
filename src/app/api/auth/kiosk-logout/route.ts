import { NextRequest, NextResponse } from 'next/server';
import { requireKioskDeviceSession } from '@/lib/deviceAuth';
import { bumpTrustedDeviceSession } from '@/lib/deviceTrust';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const kiosk = await requireKioskDeviceSession(req);
  await bumpTrustedDeviceSession(kiosk.user.id, kiosk.deviceId);
  return NextResponse.json({ ok: true });
}
