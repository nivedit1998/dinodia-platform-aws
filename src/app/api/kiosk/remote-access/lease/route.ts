import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { readDeviceHeaders } from '@/lib/deviceAuth';
import { ensureActiveDevice } from '@/lib/deviceRegistry';
import { isDeviceTrusted } from '@/lib/deviceTrust';
import { consumeStepUpApproval } from '@/lib/stepUp';
import { createRemoteAccessLease } from '@/lib/remoteAccessLease';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user || user.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const { deviceId } = readDeviceHeaders(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'Device id is required.' }, { status: 400 });
  }

  try {
    await ensureActiveDevice(deviceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'This device is blocked.';
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const trusted = await isDeviceTrusted(user.id, deviceId);
  if (!trusted) {
    return NextResponse.json(
      { error: 'This device is not trusted. Please sign in again.' },
      { status: 403 }
    );
  }

  const approval = await consumeStepUpApproval(user.id, deviceId, StepUpPurpose.REMOTE_ACCESS_SETUP);
  if (!approval) {
    return NextResponse.json(
      { error: 'Email verification is required.', stepUpRequired: true },
      { status: 403 }
    );
  }

  const lease = await createRemoteAccessLease(user.id, deviceId, StepUpPurpose.REMOTE_ACCESS_SETUP);
  return NextResponse.json({ ok: true, leaseToken: lease.token, expiresAt: lease.expiresAt });
}

