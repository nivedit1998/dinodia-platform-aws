import { NextRequest, NextResponse } from 'next/server';
import { HomeownerOnboardingFlowType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/authErrorCodes';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { sendEmail } from '@/lib/email';
import { HubInstallError, verifyBootstrapClaim } from '@/lib/hubInstall';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';
import { createPendingHomeownerOnboarding } from '@/lib/homeownerOnboardingPending';

const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fail(status: number, errorCode: AuthErrorCode, error: string) {
  return NextResponse.json({ ok: false, errorCode, error }, { status });
}

export async function POST(req: NextRequest) {
  let body: {
    serial?: string;
    bootstrapSecret?: string;
    username?: string;
    password?: string;
    email?: string;
    deviceId?: string;
    deviceLabel?: string;
  };

  try {
    body = await req.json();
  } catch {
    return fail(400, AUTH_ERROR_CODES.INVALID_LOGIN_INPUT, 'Invalid request.');
  }

  const {
    serial,
    bootstrapSecret,
    username,
    password,
    email,
    deviceId,
    deviceLabel,
  } = body ?? {};

  const ip = getClientIp(req);
  const rateKey = `register-serial:${ip}:${String(serial ?? '').toLowerCase()}`;
  const allowed = await checkRateLimit(rateKey, { maxRequests: 8, windowMs: 10 * 60_000 });
  if (!allowed) {
    return fail(
      429,
      AUTH_ERROR_CODES.RATE_LIMITED,
      'Too many setup attempts. Please wait a few minutes and try again.'
    );
  }

  if (!serial || !bootstrapSecret || !username || !password || !email || !deviceId) {
    return fail(400, AUTH_ERROR_CODES.INVALID_LOGIN_INPUT, 'All fields are required.');
  }

  if (!EMAIL_REGEX.test(email)) {
    return fail(400, AUTH_ERROR_CODES.EMAIL_INVALID, 'Please enter a valid email address.');
  }

  const existingUser = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existingUser) {
    return fail(409, AUTH_ERROR_CODES.REGISTRATION_BLOCKED, 'That username is already taken.');
  }

  const hubInstall = await verifyBootstrapClaim(serial, bootstrapSecret).catch((err) => {
    if (err instanceof HubInstallError) {
      return err;
    }
    throw err;
  });
  if (hubInstall instanceof HubInstallError) {
    return fail(hubInstall.status, AUTH_ERROR_CODES.REGISTRATION_BLOCKED, hubInstall.message);
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
    const admin = await tx.user.create({
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
    return admin;
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
    username,
    deviceLabel,
  });

  await sendEmail({
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    replyTo: REPLY_TO,
  });

  return NextResponse.json({
    ok: true,
    requiresEmailVerification: true,
    challengeId: challenge.id,
    homeId,
    pendingOnboardingId: pending.id,
  });
}
