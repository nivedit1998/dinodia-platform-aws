import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { authenticateWithCredentials } from '@/lib/auth';
import {
  AlexaOAuthError,
  buildOAuthRedirectUri,
  issueAlexaAuthorizationCode,
  validateAlexaClientRequest,
} from '@/lib/alexaOAuth';
import { prisma } from '@/lib/prisma';
import {
  buildVerifyUrl,
  createAuthChallenge,
  getAppUrl,
} from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { isDeviceTrusted } from '@/lib/deviceTrust';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';

export const runtime = 'nodejs';

const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request. Please start linking again from the Alexa app.' },
        { status: 400 }
      );
    }

    const {
      username,
      password,
      clientId,
      redirectUri,
      responseType,
      state,
      deviceId,
      deviceLabel,
    } = body as {
      username?: string;
      password?: string;
      clientId?: string;
      redirectUri?: string;
      responseType?: string;
      state?: string;
      deviceId?: string;
      deviceLabel?: string;
    };

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Please enter your Dinodia username and password.' },
        { status: 400 }
      );
    }

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { error: 'Some link details are missing. Please start linking again from the Alexa app.' },
        { status: 400 }
      );
    }

    if (responseType !== 'code') {
      return NextResponse.json(
        { error: 'We couldn’t finish linking with Alexa. Please try again.' },
        { status: 400 }
      );
    }

    const ip = getClientIp(req);
    const rateKey = `alexa-authz:${ip}:${username.toLowerCase()}`;
    const allowed = await checkRateLimit(rateKey, { maxRequests: 10, windowMs: 60_000 });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    try {
      validateAlexaClientRequest(clientId, redirectUri);
    } catch (err) {
      if (err instanceof AlexaOAuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    const authUser = await authenticateWithCredentials(username, password);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Those details don’t match any Dinodia account.' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        username: true,
        role: true,
        email: true,
        emailVerifiedAt: true,
        email2faEnabled: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'We couldn’t find your account. Please try again.' },
        { status: 404 }
      );
    }

    if (user.role === Role.ADMIN && !user.emailVerifiedAt) {
      return NextResponse.json({ error: 'Admin email not verified.' }, { status: 401 });
    }

    const verificationRequired = user.role === Role.ADMIN || user.email2faEnabled === true;
    if (user.role === Role.TENANT && user.email2faEnabled) {
      if (!user.email || !user.emailVerifiedAt) {
        return NextResponse.json(
          { error: 'Enable 2FA in the Dinodia app first.' },
          { status: 400 }
        );
      }
    }

    const issueRedirect = async () => {
      try {
        const code = await issueAlexaAuthorizationCode(authUser.id, clientId, redirectUri);
        const redirectTo = buildOAuthRedirectUri(redirectUri, code, state);
        return NextResponse.json({ redirectTo });
      } catch (err) {
        console.error('[api/alexa/oauth/authorize] failed to issue code', err);
        if (err instanceof AlexaOAuthError) {
          return NextResponse.json({ error: err.message }, { status: err.status });
        }
        return NextResponse.json(
          { error: 'We couldn’t complete linking with Alexa. Please try again in a moment.' },
          { status: 500 }
        );
      }
    };

    if (!verificationRequired) {
      return issueRedirect();
    }

    if (!deviceId) {
      return NextResponse.json(
        { error: 'Missing device identifier. Please try again.' },
        { status: 400 }
      );
    }

    const trusted = await isDeviceTrusted(user.id, deviceId);
    if (trusted) {
      return issueRedirect();
    }

    const targetEmail = user.email;
    if (!targetEmail) {
      const fallbackError =
        user.role === Role.ADMIN ? 'Admin email not verified.' : 'Enable 2FA in the Dinodia app first.';
      return NextResponse.json({ error: fallbackError }, { status: 400 });
    }

    const challenge = await createAuthChallenge({
      userId: user.id,
      purpose: 'LOGIN_NEW_DEVICE',
      email: targetEmail,
      deviceId,
    });

    const verifyUrl = buildVerifyUrl(challenge.token);
    const appUrl = getAppUrl();
    const emailContent = buildVerifyLinkEmail({
      kind: 'LOGIN_NEW_DEVICE',
      verifyUrl,
      appUrl,
      username: user.username,
      deviceLabel,
    });

    await sendEmail({
      to: targetEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      replyTo: REPLY_TO,
    });

    return NextResponse.json({
      ok: true,
      requiresEmailVerification: true,
      challengeId: challenge.id,
    });
  } catch (err) {
    console.error('[api/alexa/oauth/authorize] unexpected error', err);
    return NextResponse.json(
      { error: 'We couldn’t complete linking with Alexa. Please try again in a moment.' },
      { status: 500 }
    );
  }
}
