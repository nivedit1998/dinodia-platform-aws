import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { readDeviceHeaders } from '@/lib/deviceAuth';
import { ensureActiveDevice } from '@/lib/deviceRegistry';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { validateRemoteAccessLease } from '@/lib/remoteAccessLease';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('That doesn’t look like a valid remote access link.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Remote access links must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
}

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

  const body = (await req.json().catch(() => null)) as { leaseToken?: unknown; cloudUrl?: unknown } | null;
  const leaseToken = typeof body?.leaseToken === 'string' ? body.leaseToken : '';
  const cloudUrlRaw = typeof body?.cloudUrl === 'string' ? body.cloudUrl : '';

  const lease = await validateRemoteAccessLease(
    user.id,
    deviceId,
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

  return NextResponse.json({ ok: true, cloudEnabled: true });
}
