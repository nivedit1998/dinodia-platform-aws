import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { readDeviceHeaders, requireKioskDeviceSession } from '@/lib/deviceAuth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { validateRemoteAccessLease } from '@/lib/remoteAccessLease';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { user, deviceId } = await requireKioskDeviceSession(req);
  if (!user || user.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const { deviceId: headerDeviceId } = readDeviceHeaders(req);
  const effectiveDeviceId = headerDeviceId || deviceId;

  const body = (await req.json().catch(() => null)) as { leaseToken?: unknown } | null;
  const leaseToken = typeof body?.leaseToken === 'string' ? body.leaseToken : '';
  const lease = await validateRemoteAccessLease(
    user.id,
    effectiveDeviceId,
    StepUpPurpose.REMOTE_ACCESS_SETUP,
    leaseToken
  );
  if (!lease) {
    return NextResponse.json(
      { error: 'Email verification is required.', stepUpRequired: true },
      { status: 403 }
    );
  }

  try {
    const { haConnection } = await getUserWithHaConnection(user.id);
    return NextResponse.json({
      haUsername: haConnection.haUsername,
      haPassword: haConnection.haPassword,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to load Dinodia Hub settings.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
