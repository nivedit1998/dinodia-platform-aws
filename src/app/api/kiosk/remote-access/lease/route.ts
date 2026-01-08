import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { readDeviceHeaders, requireKioskDeviceSession } from '@/lib/deviceAuth';
import { isDeviceTrusted } from '@/lib/deviceTrust';
import { getLatestStepUpApproval } from '@/lib/stepUp';
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

  const approval = await getLatestStepUpApproval(user.id, effectiveDeviceId, StepUpPurpose.REMOTE_ACCESS_SETUP, {
    maxAgeMs: 10 * 60 * 1000, // 10 minutes from approval
  });
  if (!approval) {
    return NextResponse.json(
      { error: 'Email verification is required.', stepUpRequired: true },
      { status: 403 }
    );
  }

  // Cap lease to 5 minutes, but never extend beyond 10 minutes after step-up approval.
  const now = Date.now();
  const approvalMs = approval.approvedAt?.getTime() ?? now;
  const remainingWindowMs = Math.max(0, approvalMs + 10 * 60 * 1000 - now);
  const ttlMs = Math.min(5 * 60 * 1000, remainingWindowMs);
  if (ttlMs <= 0) {
    return NextResponse.json(
      { error: 'Email verification is required.', stepUpRequired: true },
      { status: 403 }
    );
  }

  const lease = await createRemoteAccessLease(user.id, effectiveDeviceId, StepUpPurpose.REMOTE_ACCESS_SETUP, {
    ttlMs,
  });
  return NextResponse.json({ ok: true, leaseToken: lease.token, expiresAt: lease.expiresAt });
}
