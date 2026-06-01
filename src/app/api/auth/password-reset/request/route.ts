import { NextRequest, NextResponse } from 'next/server';
import { AuthChallengePurpose, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  buildPasswordResetUrl,
  createAuthChallenge,
  getAppUrl,
} from '@/lib/authChallenges';
import { buildPasswordResetEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';

export const runtime = 'nodejs';

const TOKEN_TTL_MINUTES = 10;
const REPLY_TO = process.env.SES_REPLY_TO_EMAIL || 'niveditgupta@dinodiasmartliving.com';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const identifier =
    typeof body?.identifier === 'string' ? body.identifier.trim() : '';

  const ip = getClientIp(req);
  const rateKey = `password-reset:${ip}:${identifier.toLowerCase() || 'missing'}`;
  const allowed = await checkRateLimit(rateKey, {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many password reset requests. Please wait and try again.' },
      { status: 429 }
    );
  }

  if (!identifier) {
    return NextResponse.json({ ok: true });
  }

  const looksLikeEmail = identifier.includes('@');

  if (looksLikeEmail) {
    const matches = await prisma.user.findMany({
      where: {
        role: { not: Role.INSTALLER },
        OR: [
          { email: { equals: identifier, mode: 'insensitive' } },
          { emailPending: { equals: identifier, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        email: true,
        emailPending: true,
      },
    });

    for (const user of matches) {
      const targetEmail = user.emailPending ?? user.email;
      const canSend = Boolean(typeof targetEmail === 'string' && targetEmail.trim());
      if (!canSend || !targetEmail) continue;
      try {
        const challenge = await createAuthChallenge({
          userId: user.id,
          purpose: AuthChallengePurpose.PASSWORD_RESET,
          email: targetEmail,
          ttlMinutes: TOKEN_TTL_MINUTES,
        });

        const resetUrl = buildPasswordResetUrl(challenge.token);
        const appUrl = getAppUrl();
        const emailContent = buildPasswordResetEmail({
          resetUrl,
          appUrl,
          username: user.username,
          ttlMinutes: TOKEN_TTL_MINUTES,
        });

        await sendEmail({
          to: targetEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          replyTo: REPLY_TO,
        });
      } catch (err) {
        console.error('[password-reset:request] Failed to send reset email', err);
      }
    }

    return NextResponse.json({ ok: true });
  }

  const user = await prisma.user.findFirst({
    where: {
      username: { equals: identifier, mode: 'insensitive' },
    },
    select: {
      id: true,
      username: true,
      role: true,
      email: true,
      emailPending: true,
    },
  });

  const targetEmail = user?.emailPending ?? user?.email;
  const canSend = Boolean(
    user && user.role !== Role.INSTALLER && typeof targetEmail === 'string' && targetEmail.trim()
  );

  if (canSend && targetEmail) {
    try {
      const challenge = await createAuthChallenge({
        userId: user!.id,
        purpose: AuthChallengePurpose.PASSWORD_RESET,
        email: targetEmail,
        ttlMinutes: TOKEN_TTL_MINUTES,
      });

      const resetUrl = buildPasswordResetUrl(challenge.token);
      const appUrl = getAppUrl();
      const emailContent = buildPasswordResetEmail({
        resetUrl,
        appUrl,
        username: user!.username,
        ttlMinutes: TOKEN_TTL_MINUTES,
      });

      await sendEmail({
        to: targetEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: REPLY_TO,
      });
    } catch (err) {
      console.error('[password-reset:request] Failed to send reset email', err);
    }
  }

  return NextResponse.json({ ok: true });
}
