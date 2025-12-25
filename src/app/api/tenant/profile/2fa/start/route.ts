import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildVerifyUrl, createAuthChallenge, getAppUrl } from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';

const EMAIL_REGEX = /.+@.+\..+/;
const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';

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
        email?: string;
        confirmEmail?: string;
        deviceId?: string;
        deviceLabel?: string;
      }
    | null = null;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const confirmEmail =
    typeof body?.confirmEmail === 'string' ? body.confirmEmail.trim() : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  const deviceLabel =
    typeof body?.deviceLabel === 'string' ? body.deviceLabel.trim() : undefined;

  if (!email || !confirmEmail || !deviceId) {
    return NextResponse.json(
      { error: 'Please provide your email address and device details.' },
      { status: 400 }
    );
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { error: 'Please enter a valid email address.' },
      { status: 400 }
    );
  }

  if (email !== confirmEmail) {
    return NextResponse.json(
      { error: 'Email addresses do not match.' },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      id: true,
      username: true,
      email2faEnabled: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  if (user.email2faEnabled && user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyEnabled: true });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailPending: email,
      email2faEnabled: false,
    },
  });

  const challenge = await createAuthChallenge({
    userId: user.id,
    purpose: 'TENANT_ENABLE_2FA',
    email,
    deviceId,
  });

  const appUrl = getAppUrl();
  const verifyUrl = buildVerifyUrl(challenge.token);
  const emailContent = buildVerifyLinkEmail({
    kind: 'TENANT_ENABLE_2FA',
    verifyUrl,
    appUrl,
    username: user.username,
    deviceLabel,
  });

  await sendEmail({
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    replyTo: REPLY_TO,
  });

  return NextResponse.json({ ok: true, challengeId: challenge.id });
}
