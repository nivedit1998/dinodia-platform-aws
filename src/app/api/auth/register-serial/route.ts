import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { sendEmail } from '@/lib/email';
import { HubInstallError, verifyBootstrapClaim } from '@/lib/hubInstall';

const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('That base URL is not valid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Base URL must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
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
    haUsername?: string;
    haPassword?: string;
    haBaseUrl?: string;
    haLongLivedToken?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const {
    serial,
    bootstrapSecret,
    username,
    password,
    email,
    deviceId,
    deviceLabel,
    haUsername,
    haPassword,
    haBaseUrl,
    haLongLivedToken,
  } = body ?? {};

  if (!serial || !bootstrapSecret || !username || !password || !email || !deviceId || !haUsername || !haPassword || !haBaseUrl || !haLongLivedToken) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  let normalizedBaseUrl: string;
  try {
    normalizedBaseUrl = normalizeBaseUrl(haBaseUrl);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser) {
    return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
  }

  let hubInstall;
  try {
    hubInstall = await verifyBootstrapClaim(serial, bootstrapSecret);
  } catch (err) {
    if (err instanceof HubInstallError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const normalizedToken = haLongLivedToken.trim();
  const duplicateToken = await prisma.haConnection.findFirst({
    where: { longLivedToken: normalizedToken },
    select: { id: true },
  });
  if (duplicateToken) {
    return NextResponse.json({ error: 'That Dinodia Hub is already linked to another account.' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const haConnection = await tx.haConnection.create({
      data: {
        baseUrl: normalizedBaseUrl,
        cloudUrl: null,
        haUsername: haUsername.trim(),
        haPassword,
        longLivedToken: normalizedToken,
      },
    });

    const home = await tx.home.create({
      data: {
        haConnectionId: haConnection.id,
        addressLine1: '',
        addressLine2: null,
        city: '',
        state: null,
        postcode: '',
        country: '',
      },
    });

    const admin = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: Role.ADMIN,
        emailPending: email,
        emailVerifiedAt: null,
        homeId: home.id,
        haConnectionId: haConnection.id,
      },
    });

    await tx.haConnection.update({
      where: { id: haConnection.id },
      data: { ownerId: admin.id },
    });

    await tx.hubInstall.update({
      where: { id: hubInstall.id },
      data: { homeId: home.id },
    });

    return { admin, homeId: home.id };
  });

  const challenge = await createAuthChallenge({
    userId: result.admin.id,
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
    homeId: result.homeId,
  });
}
