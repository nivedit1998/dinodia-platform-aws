import { NextRequest, NextResponse } from 'next/server';
import { AuthChallengePurpose, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { trustDevice } from '@/lib/deviceTrust';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  let body:
    | {
        challengeId?: string;
        deviceId?: string;
        deviceLabel?: string;
      }
    | null = null;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
  const deviceLabel =
    typeof body?.deviceLabel === 'string' ? body.deviceLabel.trim() : undefined;

  if (!challengeId || !deviceId) {
    return NextResponse.json(
      { error: 'Verification details are missing or incomplete.' },
      { status: 400 }
    );
  }

  const challenge = await prisma.authChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      userId: true,
      purpose: true,
      email: true,
      deviceId: true,
      expiresAt: true,
      approvedAt: true,
      consumedAt: true,
    },
  });

  if (!challenge || challenge.userId !== me.id) {
    return NextResponse.json({ error: 'Verification request not found.' }, { status: 404 });
  }

  if (challenge.purpose !== AuthChallengePurpose.TENANT_ENABLE_2FA) {
    return NextResponse.json({ error: 'Invalid verification purpose.' }, { status: 400 });
  }

  if (challenge.deviceId && challenge.deviceId !== deviceId) {
    return NextResponse.json({ error: 'This device cannot complete verification.' }, { status: 403 });
  }

  if (!challenge.approvedAt) {
    return NextResponse.json({ error: 'Verification email not yet approved.' }, { status: 400 });
  }

  if (challenge.consumedAt) {
    return NextResponse.json({ error: 'Verification link already used.' }, { status: 400 });
  }

  if (challenge.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Verification link has expired.' }, { status: 410 });
  }

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { email: true, emailPending: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const now = new Date();
  const emailToUse = user.emailPending || challenge.email;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: me.id },
      data: {
        email: emailToUse,
        emailPending: null,
        emailVerifiedAt: now,
        email2faEnabled: true,
      },
    });

    await trustDevice(me.id, deviceId, deviceLabel, tx);

    await tx.authChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: now },
    });
  });

  return NextResponse.json({ ok: true });
}
