import 'server-only';

import crypto from 'crypto';
import { AuditEventType, AuthChallengePurpose } from '@prisma/client';
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
      userId: true,
      expiresAt: true,
      consumedAt: true,
      approvedAt: true,
    },
  });

  if (!challenge) return { ok: false, reason: 'NOT_FOUND' };
  if (challenge.consumedAt) return { ok: false, reason: 'ALREADY_CONSUMED' };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };

  if (!challenge.approvedAt) {
    const approvedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.authChallenge.update({
        where: { id: challenge.id },
        data: { approvedAt },
      });

      const supportRequest = await tx.supportRequest.findUnique({
        where: { authChallengeId: challenge.id },
        select: {
          id: true,
          kind: true,
          homeId: true,
          installerUserId: true,
          targetUserId: true,
          scope: true,
          reason: true,
        },
      });

      if (supportRequest) {
        await tx.supportRequest.update({
          where: { id: supportRequest.id },
          data: { approvedByUserId: challenge.userId },
        });

        await tx.auditEvent.create({
          data: {
            type: AuditEventType.SUPPORT_REQUEST_APPROVED,
            homeId: supportRequest.homeId,
            actorUserId: challenge.userId,
            metadata: {
              supportRequestId: supportRequest.id,
              kind: supportRequest.kind,
              installerUserId: supportRequest.installerUserId,
              targetUserId: supportRequest.targetUserId,
              scope: supportRequest.scope,
              reason: supportRequest.reason,
              approvedAt: approvedAt.toISOString(),
            },
          },
        });
      }
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

export type ChallengeStatusDetail = {
  status: 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND';
  challengeId?: string;
  expiresAt?: string;
  approvedAt?: string | null;
  consumedAt?: string | null;
  serverNow: string;
};

export async function getChallengeStatusDetail(id: string): Promise<ChallengeStatusDetail> {
  const challenge = await prisma.authChallenge.findUnique({
    where: { id },
    select: {
      id: true,
      expiresAt: true,
      approvedAt: true,
      consumedAt: true,
    },
  });

  const serverNow = new Date().toISOString();

  if (!challenge) return { status: 'NOT_FOUND', serverNow };

  const detail = {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt.toISOString(),
    approvedAt: challenge.approvedAt?.toISOString() ?? null,
    consumedAt: challenge.consumedAt?.toISOString() ?? null,
    serverNow,
  };

  if (challenge.consumedAt) return { status: 'CONSUMED', ...detail };
  if (challenge.expiresAt < new Date()) return { status: 'EXPIRED', ...detail };
  if (challenge.approvedAt) return { status: 'APPROVED', ...detail };
  return { status: 'PENDING', ...detail };
}

export async function getChallengeStatus(id: string): Promise<
  'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND'
> {
  const detail = await getChallengeStatusDetail(id);
  return detail.status;
}

export async function resendChallengeEmail(id: string): Promise<
  | { ok: true; resentAt: string; resendAvailableAt: string; expiresAt: string }
  | { ok: false; reason: string; retryAfterSeconds?: number }
> {
  const challenge = await prisma.authChallenge.findUnique({
    where: { id },
    include: { user: { select: { username: true } } },
  });

  if (!challenge) return { ok: false, reason: 'NOT_FOUND' };
  if (challenge.purpose === AuthChallengePurpose.PASSWORD_RESET) {
    return { ok: false, reason: 'UNSUPPORTED' };
  }
  if (challenge.consumedAt) return { ok: false, reason: 'ALREADY_CONSUMED' };
  if (challenge.approvedAt) return { ok: false, reason: 'ALREADY_APPROVED' };
  if (challenge.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };

  const secondsSinceCreated = (Date.now() - challenge.createdAt.getTime()) / 1000;
  if (secondsSinceCreated < RESEND_COOLDOWN_SECONDS) {
    return {
      ok: false,
      reason: 'TOO_SOON',
      retryAfterSeconds: Math.max(1, Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceCreated)),
    };
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const resentAt = new Date();

  await prisma.authChallenge.update({
    where: { id: challenge.id },
    data: { tokenHash, createdAt: resentAt },
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

  return {
    ok: true,
    resentAt: resentAt.toISOString(),
    resendAvailableAt: new Date(
      resentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000
    ).toISOString(),
    expiresAt: challenge.expiresAt.toISOString(),
  };
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

export function buildPasswordResetUrl(token: string) {
  return `${getAppUrl()}/reset-password?token=${token}`;
}
