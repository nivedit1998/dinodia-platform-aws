import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { readDeviceHeaders, requireKioskDeviceSession } from '@/lib/deviceAuth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { validateRemoteAccessLease } from '@/lib/remoteAccessLease';
import { prisma } from '@/lib/prisma';
import { consumeLatestStepUpApproval } from '@/lib/stepUp';

export const runtime = 'nodejs';

const MASK_CHARS = /[\u2022\*]/; // bullet or asterisk mask

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('That doesn’t look like a valid remote access link.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Remote access links must start with https://');
  }
  if (MASK_CHARS.test(trimmed) || MASK_CHARS.test(parsed.host) || MASK_CHARS.test(parsed.hostname)) {
    throw new Error('Unhide the full link before saving.');
  }
  if (!parsed.hostname.endsWith('.ui.nabu.casa')) {
    throw new Error('Only Nabu Casa cloud links are allowed.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export async function POST(req: NextRequest) {
  const { user, deviceId } = await requireKioskDeviceSession(req);
  if (!user || user.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const { deviceId: headerDeviceId } = readDeviceHeaders(req);
  const effectiveDeviceId = headerDeviceId || deviceId;

  const body = (await req.json().catch(() => null)) as { leaseToken?: unknown; cloudUrl?: unknown } | null;
  const leaseToken = typeof body?.leaseToken === 'string' ? body.leaseToken : '';
  const cloudUrlRaw = typeof body?.cloudUrl === 'string' ? body.cloudUrl : '';

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

  let normalizedCloudUrl: string;
  try {
    normalizedCloudUrl = normalizeUrl(cloudUrlRaw);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const { haConnection } = await getUserWithHaConnection(user.id);
  await prisma.haConnection.update({
    where: { id: haConnection.id },
    data: { cloudUrl: normalizedCloudUrl },
    select: { id: true },
  });

  await prisma.remoteAccessLease.update({
    where: { id: lease.id },
    data: { revokedAt: new Date() },
    select: { id: true },
  });

  // Consume the step-up approval now that remote access has been saved.
  await consumeLatestStepUpApproval(user.id, effectiveDeviceId, StepUpPurpose.REMOTE_ACCESS_SETUP);

  return NextResponse.json({ ok: true, cloudEnabled: true });
}
