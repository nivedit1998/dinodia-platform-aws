import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/authErrorCodes';
import { HomeownerOnboardingFlowType, Role } from '@prisma/client';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { HubInstallError, verifyBootstrapClaim } from '@/lib/hubInstall';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';
import { createPendingHomeownerOnboarding } from '@/lib/homeownerOnboardingPending';

function fail(status: number, errorCode: AuthErrorCode, error: string) {
  return NextResponse.json({ ok: false, errorCode, error }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { username, password, email, deviceId, deviceLabel, dinodiaSerial, bootstrapSecret } = body;

    const ip = getClientIp(req);
    const rateKey = `register-admin:${ip}:${String(dinodiaSerial ?? '').toLowerCase()}`;
    const allowed = await checkRateLimit(rateKey, { maxRequests: 8, windowMs: 10 * 60_000 });
    if (!allowed) {
      return fail(
        429,
        AUTH_ERROR_CODES.RATE_LIMITED,
        'Too many setup attempts. Please wait a few minutes and try again.'
      );
    }

    if (!username || !password || !email || !deviceId || !dinodiaSerial || !bootstrapSecret) {
      return fail(
        400,
        AUTH_ERROR_CODES.INVALID_LOGIN_INPUT,
        'Please fill in all fields to connect your Dinodia Hub.'
      );
    }

    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRegex.test(email)) {
      return fail(400, AUTH_ERROR_CODES.EMAIL_INVALID, 'Please enter a valid email address.');
    }

    const existing = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      return fail(409, AUTH_ERROR_CODES.REGISTRATION_BLOCKED, 'That username is already taken. Try another one.');
    }

    let hubInstall;
    try {
      hubInstall = await verifyBootstrapClaim(dinodiaSerial, bootstrapSecret);
    } catch (err) {
      if (err instanceof HubInstallError) {
        return fail(err.status, AUTH_ERROR_CODES.REGISTRATION_BLOCKED, err.message);
      }
      throw err;
    }

    const homeId = hubInstall.homeId;
    if (!homeId) {
      return fail(
        400,
        AUTH_ERROR_CODES.REGISTRATION_BLOCKED,
        'This Dinodia Hub is not fully provisioned. Ask your installer to provision it.'
      );
    }

    const home = await prisma.home.findUnique({
      where: { id: homeId },
      include: {
        users: { select: { id: true }, take: 1 },
        haConnection: true,
      },
    });
    if (!home || !home.haConnection) {
      return fail(
        400,
        AUTH_ERROR_CODES.REGISTRATION_BLOCKED,
        'Dinodia Hub provisioning is incomplete. Ask your installer to provision it again.'
      );
    }
    if (home.users.length > 0) {
      return fail(409, AUTH_ERROR_CODES.REGISTRATION_BLOCKED, 'This Dinodia Hub is already claimed.');
    }

    const activePending = await prisma.pendingHomeownerOnboarding.findFirst({
      where: {
        homeId,
        flowType: HomeownerOnboardingFlowType.SETUP_QR,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (activePending) {
      return fail(
        409,
        AUTH_ERROR_CODES.REGISTRATION_BLOCKED,
        'Homeowner setup is already pending for this Dinodia Hub. Ask the homeowner to complete email verification and policy acceptance.'
      );
    }

    const passwordHash = await hashPassword(password);

    const admin = await prisma.$transaction(async (tx) => {
      const createdAdmin = await tx.user.create({
        data: {
          username,
          passwordHash,
          role: Role.ADMIN,
          emailPending: email,
          emailVerifiedAt: null,
          homeId: null,
          haConnectionId: null,
        },
      });
      return createdAdmin;
    });

    const pending = await createPendingHomeownerOnboarding({
      flowType: HomeownerOnboardingFlowType.SETUP_QR,
      userId: admin.id,
      proposedUsername: admin.username,
      proposedPasswordHash: passwordHash,
      proposedEmail: email,
      deviceId,
      deviceLabel: typeof deviceLabel === 'string' ? deviceLabel : null,
      homeId,
      hubInstallId: hubInstall.id,
    });

    const challenge = await createAuthChallenge({
      userId: admin.id,
      purpose: 'ADMIN_EMAIL_VERIFY',
      email,
      deviceId,
    });

    const appUrl = getAppUrl();
    const verifyUrl = buildVerifyUrl(challenge.token);
    const emailContent = buildVerifyLinkEmail({
      kind: 'ADMIN_EMAIL_VERIFY',
      verifyUrl,
      appUrl,
      username: admin.username,
      deviceLabel,
    });

    await sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      replyTo: 'niveditgupta@dinodiasmartliving.com',
    });

    return NextResponse.json({
      ok: true,
      requiresEmailVerification: true,
      challengeId: challenge.id,
      pendingOnboardingId: pending.id,
    });
  } catch (err) {
    console.error(err);
    return fail(
      500,
      AUTH_ERROR_CODES.INTERNAL_ERROR,
      'We couldn’t finish setting up the homeowner account. Please try again.'
    );
  }
}
