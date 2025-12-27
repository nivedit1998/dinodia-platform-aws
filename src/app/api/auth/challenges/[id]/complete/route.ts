import { NextRequest, NextResponse } from 'next/server';
import {
  AuditEventType,
  AuthChallengePurpose,
  HomeStatus,
  Role,
  StepUpPurpose,
} from '@prisma/client';
import { consumeChallenge } from '@/lib/authChallenges';
import { prisma } from '@/lib/prisma';
import { trustDevice } from '@/lib/deviceTrust';
import { createSessionForUser, createTokenForUser } from '@/lib/auth';
import { createStepUpApproval } from '@/lib/stepUp';

async function finalizeHomeClaimForAdmin(userId: number, username: string) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const userRecord = await tx.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        haConnectionId: true,
        home: {
          select: {
            id: true,
            status: true,
            claimCodeHash: true,
            claimCodeConsumedAt: true,
            haConnectionId: true,
            haConnection: { select: { ownerId: true } },
          },
        },
      },
    });

    const home = userRecord?.home;
    if (
      !home ||
      !home.claimCodeHash ||
      home.claimCodeConsumedAt ||
      (home.status !== HomeStatus.UNCLAIMED && home.status !== HomeStatus.TRANSFER_PENDING)
    ) {
      return false;
    }

    if (home.haConnection?.ownerId && home.haConnection.ownerId !== userId) {
      return false;
    }

    await tx.haConnection.update({
      where: { id: home.haConnectionId },
      data: { ownerId: userId },
    });

    if (userRecord?.haConnectionId !== home.haConnectionId) {
      await tx.user.update({
        where: { id: userId },
        data: { haConnectionId: home.haConnectionId },
      });
    }

    await tx.home.update({
      where: { id: home.id },
      data: { status: HomeStatus.ACTIVE, claimCodeConsumedAt: now },
    });

    await tx.auditEvent.create({
      data: {
        type: AuditEventType.HOME_CLAIMED,
        homeId: home.id,
        actorUserId: userId,
        metadata: { userId, username },
      },
    });

    return true;
  });
}

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const deviceId = body?.deviceId as string | undefined;
  const deviceLabel = body?.deviceLabel as string | undefined;

  if (!deviceId) {
    return NextResponse.json({ error: 'Device information is required.' }, { status: 400 });
  }

  const result = await consumeChallenge({ id, deviceId });
  if (!result.ok || !result.challenge) {
    const status =
      result.reason === 'NOT_FOUND' ? 404 :
      result.reason === 'EXPIRED' ? 410 :
      result.reason === 'DEVICE_MISMATCH' ? 403 :
      400;
    return NextResponse.json(
      { error: 'Unable to complete verification.', reason: result.reason },
      { status }
    );
  }

  const challenge = result.challenge;
  const user = await prisma.user.findUnique({
    where: { id: challenge.userId },
    select: {
      id: true,
      username: true,
      role: true,
      email: true,
      emailPending: true,
      emailVerifiedAt: true,
      email2faEnabled: true,
      home: {
        select: {
          id: true,
          status: true,
          claimCodeHash: true,
          claimCodeConsumedAt: true,
          haConnectionId: true,
          haConnection: { select: { ownerId: true, cloudUrl: true } },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const sessionUser = {
    id: user.id,
    username: user.username,
    role: user.role,
  };
  const cloudEnabled = Boolean(user.home?.haConnection?.cloudUrl?.trim());
  const token = createTokenForUser(sessionUser);

  switch (challenge.purpose) {
    case AuthChallengePurpose.ADMIN_EMAIL_VERIFY: {
      if (user.role !== Role.ADMIN) {
        return NextResponse.json({ error: 'Invalid verification target.' }, { status: 400 });
      }

      const now = new Date();
      if (user.emailPending) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            email: user.emailPending,
            emailPending: null,
            emailVerifiedAt: now,
          },
        });
      } else if (user.email && !user.emailVerifiedAt) {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: now },
        });
      } else {
        return NextResponse.json(
          { error: 'No pending admin email to verify.' },
          { status: 400 }
        );
      }

      const finalizedClaim = await finalizeHomeClaimForAdmin(user.id, user.username);
      await trustDevice(user.id, deviceId, deviceLabel);
      await createSessionForUser(sessionUser);
      return NextResponse.json({
        ok: true,
        role: user.role,
        token,
        homeClaimed: finalizedClaim,
        cloudEnabled,
      });
    }
    case AuthChallengePurpose.LOGIN_NEW_DEVICE: {
      if (user.role === Role.ADMIN && !user.emailVerifiedAt) {
        return NextResponse.json(
          { error: 'Admin email must be verified before login.' },
          { status: 403 }
        );
      }

      await trustDevice(user.id, deviceId, deviceLabel);
      await createSessionForUser(sessionUser);
      return NextResponse.json({ ok: true, role: user.role, token, cloudEnabled });
    }
    case AuthChallengePurpose.TENANT_ENABLE_2FA: {
      const now = new Date();
      if (!user.emailVerifiedAt) {
        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: now },
        });
      }
      await trustDevice(user.id, deviceId, deviceLabel);
      await createSessionForUser(sessionUser);
      return NextResponse.json({ ok: true, role: user.role, token, cloudEnabled });
    }
    case AuthChallengePurpose.REMOTE_ACCESS_SETUP: {
      if (user.role !== Role.ADMIN) {
        return NextResponse.json({ error: 'Invalid verification target.' }, { status: 400 });
      }
      await createStepUpApproval(user.id, deviceId, StepUpPurpose.REMOTE_ACCESS_SETUP);
      return NextResponse.json({ ok: true, stepUpApproved: true });
    }
    default:
      return NextResponse.json({ error: 'Unsupported verification type.' }, { status: 400 });
  }
}
