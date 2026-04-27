import { NextRequest, NextResponse } from 'next/server';
import {
  AuthChallengePurpose,
  Role,
  StepUpPurpose,
} from '@prisma/client';
import { consumeChallenge } from '@/lib/authChallenges';
import { prisma } from '@/lib/prisma';
import { trustDevice } from '@/lib/deviceTrust';
import { createKioskToken, createSessionForUser, createTokenForUser } from '@/lib/auth';
import { createStepUpApproval } from '@/lib/stepUp';
import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/authErrorCodes';
import { getHomeownerPolicyStatus } from '@/lib/homeownerPolicy';
import { markPendingHomeownerEmailVerified } from '@/lib/homeownerOnboardingPending';

export const runtime = 'nodejs';

function fail(status: number, errorCode: AuthErrorCode, error: string, extras: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, errorCode, error, ...extras }, { status });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const deviceId = body?.deviceId as string | undefined;
  const deviceLabel = body?.deviceLabel as string | undefined;

  if (!deviceId) {
    return fail(400, AUTH_ERROR_CODES.DEVICE_REQUIRED, 'Device information is required.');
  }

  const result = await consumeChallenge({ id, deviceId });
  if (!result.ok || !result.challenge) {
    const status =
      result.reason === 'NOT_FOUND' ? 404 :
      result.reason === 'EXPIRED' ? 410 :
      result.reason === 'DEVICE_MISMATCH' ? 403 :
      400;
    const message =
      result.reason === 'NOT_FOUND'
        ? 'Verification request not found.'
        : result.reason === 'EXPIRED'
          ? 'Verification request expired.'
          : result.reason === 'DEVICE_MISMATCH'
            ? 'This verification request is for a different device.'
            : 'Unable to complete verification.';
    return fail(
      status,
      AUTH_ERROR_CODES.VERIFICATION_FAILED,
      message,
      { reason: result.reason }
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
    return fail(404, AUTH_ERROR_CODES.INTERNAL_ERROR, 'User not found.');
  }

  const sessionUser = {
    id: user.id,
    username: user.username,
    role: user.role,
  };
  const cloudEnabled = Boolean(user.home?.haConnection?.cloudUrl?.trim());
  const trustedRow = await prisma.trustedDevice.findUnique({
    where: { userId_deviceId: { userId: user.id, deviceId } },
    select: { sessionVersion: true },
  });
  const sessionVersion = Number(trustedRow?.sessionVersion ?? 0);
  const buildKioskToken = (version: number) => createKioskToken(sessionUser, deviceId, version);
  const webToken = createTokenForUser(sessionUser);

  switch (challenge.purpose) {
    case AuthChallengePurpose.ADMIN_EMAIL_VERIFY: {
      if (user.role !== Role.ADMIN) {
        return fail(400, AUTH_ERROR_CODES.VERIFICATION_FAILED, 'Invalid verification target.');
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
        return fail(400, AUTH_ERROR_CODES.VERIFICATION_FAILED, 'No pending admin email to verify.');
      }

      const pending = await markPendingHomeownerEmailVerified(user.id);
      await trustDevice(user.id, deviceId, deviceLabel);
      const refreshed = await prisma.trustedDevice.findUnique({
        where: { userId_deviceId: { userId: user.id, deviceId } },
        select: { sessionVersion: true },
      });
      const kioskToken = buildKioskToken(Number(refreshed?.sessionVersion ?? sessionVersion));
      await createSessionForUser(sessionUser);
      const policy = await getHomeownerPolicyStatus(user.id);
      return NextResponse.json({
        ok: true,
        role: user.role,
        token: kioskToken,
        webToken,
        requiresHomeownerPolicyAcceptance: policy?.requiresAcceptance ?? true,
        homeownerPolicyVersion: policy?.policyVersion ?? '2026-V1',
        pendingOnboardingId: pending?.id ?? policy?.pendingOnboardingId ?? null,
        cloudEnabled,
      });
    }
    case AuthChallengePurpose.LOGIN_NEW_DEVICE: {
      if (user.role === Role.ADMIN && !user.emailVerifiedAt) {
        return fail(403, AUTH_ERROR_CODES.VERIFICATION_REQUIRED, 'Admin email must be verified before login.');
      }

      await trustDevice(user.id, deviceId, deviceLabel);
      const refreshed = await prisma.trustedDevice.findUnique({
        where: { userId_deviceId: { userId: user.id, deviceId } },
        select: { sessionVersion: true },
      });
      const kioskToken = buildKioskToken(Number(refreshed?.sessionVersion ?? sessionVersion));
      await createSessionForUser(sessionUser);
      if (user.role === Role.ADMIN) {
        const policy = await getHomeownerPolicyStatus(user.id);
        return NextResponse.json({
          ok: true,
          role: user.role,
          token: kioskToken,
          webToken,
          cloudEnabled,
          requiresHomeownerPolicyAcceptance: policy?.requiresAcceptance ?? true,
          homeownerPolicyVersion: policy?.policyVersion ?? '2026-V1',
          pendingOnboardingId: policy?.pendingOnboardingId ?? null,
        });
      }
      return NextResponse.json({ ok: true, role: user.role, token: kioskToken, webToken, cloudEnabled });
    }
    case AuthChallengePurpose.TENANT_ENABLE_2FA: {
      const now = new Date();
      const emailToUse = user.emailPending || challenge.email || user.email;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          email: emailToUse ?? undefined,
          emailPending: null,
          emailVerifiedAt: now,
          email2faEnabled: true,
        },
      });

      await trustDevice(user.id, deviceId, deviceLabel);
      const refreshed = await prisma.trustedDevice.findUnique({
        where: { userId_deviceId: { userId: user.id, deviceId } },
        select: { sessionVersion: true },
      });
      const kioskToken = buildKioskToken(Number(refreshed?.sessionVersion ?? sessionVersion));
      await createSessionForUser(sessionUser);
      return NextResponse.json({ ok: true, role: user.role, token: kioskToken, webToken, cloudEnabled });
    }
    case AuthChallengePurpose.REMOTE_ACCESS_SETUP: {
      if (user.role !== Role.ADMIN) {
        return fail(400, AUTH_ERROR_CODES.VERIFICATION_FAILED, 'Invalid verification target.');
      }
      await createStepUpApproval(user.id, deviceId, StepUpPurpose.REMOTE_ACCESS_SETUP);
      return NextResponse.json({ ok: true, stepUpApproved: true });
    }
    default:
      return fail(400, AUTH_ERROR_CODES.VERIFICATION_FAILED, 'Unsupported verification type.');
  }
}
