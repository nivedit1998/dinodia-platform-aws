import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { readDeviceHeaders, requireKioskDeviceSession } from '@/lib/deviceAuth';
import { isDeviceTrusted } from '@/lib/deviceTrust';
import { consumeStepUpApproval } from '@/lib/stepUp';
import { createRemoteAccessLease } from '@/lib/remoteAccessLease';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { user, deviceId } = await requireKioskDeviceSession(req);
  if (!user || user.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const { deviceId: headerDeviceId } = readDeviceHeaders(req);
  const effectiveDeviceId = headerDeviceId || deviceId;

  const trusted = await isDeviceTrusted(user.id, effectiveDeviceId);
  if (!trusted) {
    return NextResponse.json(
      { error: 'This device is not trusted. Please sign in again.' },
      { status: 403 }
    );
  }

  const approval = await consumeStepUpApproval(user.id, effectiveDeviceId, StepUpPurpose.REMOTE_ACCESS_SETUP);
  if (!approval) {
    return NextResponse.json(
      { error: 'Email verification is required.', stepUpRequired: true },
      { status: 403 }
    );
  }

  const lease = await createRemoteAccessLease(
    user.id,
    effectiveDeviceId,
    StepUpPurpose.REMOTE_ACCESS_SETUP
  );
  return NextResponse.json({ ok: true, leaseToken: lease.token, expiresAt: lease.expiresAt });
}
