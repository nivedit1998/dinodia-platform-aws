import 'server-only';

import crypto from 'crypto';
import { AuthChallengePurpose } from '@prisma/client';
import { prisma } from './prisma';
import { buildVerifyLinkEmail } from './emailTemplates';
import { sendEmail } from './email';

const DEFAULT_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 30;
const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';

export function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    'http://localhost:3000'
  );
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createAuthChallenge(args: {
  userId: number;
  purpose: AuthChallengePurpose;
  email: string;
  deviceId?: string | null;
  ttlMinutes?: number;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + (args.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60 * 1000
  );

  const challenge = await prisma.authChallenge.create({
    data: {
      userId: args.userId,
      purpose: args.purpose,
      email: args.email,
      deviceId: args.deviceId ?? null,
      tokenHash,
      expiresAt,
    },
  });

  return { id: challenge.id, token, expiresAt };
}

export async function approveAuthChallengeByToken(rawToken: string): Promise<{
  ok: boolean;
  reason?: string;
  challengeId?: string;
}> {
  const tokenHash = hashToken(rawToken);
  const challenge = await prisma.authChallenge.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      consumedAt: true,
      approvedAt: true,
    },
  });

  if (!challenge) return { ok: false, reason: 'NOT_FOUND' };
  if (challenge.consumedAt) return { ok: false, reason: 'ALREADY_CONSUMED' };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };

  if (!challenge.approvedAt) {
    await prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { approvedAt: new Date() },
    });
  }

  return { ok: true, challengeId: challenge.id };
}

export async function getChallengeStatusByToken(rawToken: string): Promise<{
  status: 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND';
  challengeId?: string;
}> {
  const tokenHash = hashToken(rawToken);
  const challenge = await prisma.authChallenge.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      approvedAt: true,
      consumedAt: true,
    },
  });

  if (!challenge) return { status: 'NOT_FOUND' };
  if (challenge.consumedAt) return { status: 'CONSUMED', challengeId: challenge.id };
  if (challenge.expiresAt < new Date()) return { status: 'EXPIRED', challengeId: challenge.id };
  if (challenge.approvedAt) return { status: 'APPROVED', challengeId: challenge.id };
  return { status: 'PENDING', challengeId: challenge.id };
}

export async function getChallengeStatus(id: string): Promise<
  'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND'
> {
  const challenge = await prisma.authChallenge.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      approvedAt: true,
      consumedAt: true,
    },
  });

  if (!challenge) return 'NOT_FOUND';
  if (challenge.consumedAt) return 'CONSUMED';
  if (challenge.expiresAt < new Date()) return 'EXPIRED';
  if (challenge.approvedAt) return 'APPROVED';
  return 'PENDING';
}

export async function resendChallengeEmail(id: string): Promise<{ ok: boolean; reason?: string }> {
  const challenge = await prisma.authChallenge.findUnique({
    where: { id },
    include: { user: { select: { username: true } } },
  });

  if (!challenge) return { ok: false, reason: 'NOT_FOUND' };
  if (challenge.consumedAt) return { ok: false, reason: 'ALREADY_CONSUMED' };
  if (challenge.approvedAt) return { ok: false, reason: 'ALREADY_APPROVED' };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };

  const secondsSinceCreated = (Date.now() - challenge.createdAt.getTime()) / 1000;
  if (secondsSinceCreated < RESEND_COOLDOWN_SECONDS) {
    return { ok: false, reason: 'TOO_SOON' };
  }

  const token = generateToken();
  const tokenHash = hashToken(token);

  await prisma.authChallenge.update({
    where: { id: challenge.id },
    data: { tokenHash },
  });

  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/auth/verify?token=${token}`;

  const email = buildVerifyLinkEmail({
    kind: challenge.purpose,
    verifyUrl,
    appUrl,
    username: challenge.user?.username,
  });

  await sendEmail({
    to: challenge.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo: REPLY_TO,
  });

  return { ok: true };
}

export async function consumeChallenge(args: {
  id: string;
  deviceId?: string;
}): Promise<{
  ok: boolean;
  reason?: string;
  challenge?: {
    userId: number;
    purpose: AuthChallengePurpose;
    email: string;
    deviceId: string | null;
  };
}> {
  const challenge = await prisma.authChallenge.findUnique({
    where: { id: args.id },
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

  if (!challenge) return { ok: false, reason: 'NOT_FOUND' };
  if (challenge.consumedAt) return { ok: false, reason: 'ALREADY_CONSUMED' };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };
  if (!challenge.approvedAt) return { ok: false, reason: 'NOT_APPROVED' };
  const relaxedDevicePurposes = new Set<AuthChallengePurpose>([
    AuthChallengePurpose.ADMIN_EMAIL_VERIFY,
    AuthChallengePurpose.LOGIN_NEW_DEVICE,
    AuthChallengePurpose.TENANT_ENABLE_2FA,
  ]);

  if (challenge.deviceId && args.deviceId && challenge.deviceId !== args.deviceId) {
    if (!relaxedDevicePurposes.has(challenge.purpose)) {
      return { ok: false, reason: 'DEVICE_MISMATCH' };
    }
  }
  if (challenge.deviceId && !args.deviceId) {
    if (!relaxedDevicePurposes.has(challenge.purpose)) {
      return { ok: false, reason: 'DEVICE_REQUIRED' };
    }
  }

  await prisma.authChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return {
    ok: true,
    challenge: {
      userId: challenge.userId,
      purpose: challenge.purpose,
      email: challenge.email,
      deviceId: challenge.deviceId,
    },
  };
}

export function buildVerifyUrl(token: string) {
  return `${getAppUrl()}/auth/verify?token=${token}`;
}
