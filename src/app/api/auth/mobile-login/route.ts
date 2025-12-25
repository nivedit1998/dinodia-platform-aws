import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import {
  authenticateWithCredentials,
  createTokenForUser,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  createAuthChallenge,
  buildVerifyUrl,
  getAppUrl,
} from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { isDeviceTrusted, touchTrustedDevice } from '@/lib/deviceTrust';

const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  try {
    const { username, password, deviceId, deviceLabel, email } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Please enter both a username and password.' },
        { status: 400 }
      );
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
        emailPending: true,
        emailVerifiedAt: true,
        email2faEnabled: true,
        home: {
          select: {
            haConnection: {
              select: {
                cloudUrl: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'We could not find your account. Please try again.' },
        { status: 404 }
      );
    }

    const sessionUser = {
      id: user.id,
      username: user.username,
      role: user.role,
    };
    const cloudEnabled = Boolean(user.home?.haConnection?.cloudUrl?.trim());
    const appUrl = getAppUrl();

    if (user.role === Role.ADMIN) {
      if (!user.emailVerifiedAt) {
        let targetEmail = user.emailPending || user.email;

        if (!targetEmail) {
          if (!email) {
            return NextResponse.json({
              ok: true,
              requiresEmailVerification: true,
              needsEmailInput: true,
            });
          }
          if (!EMAIL_REGEX.test(email)) {
            return NextResponse.json(
              { error: 'Please enter a valid email address.' },
              { status: 400 }
            );
          }
          targetEmail = email;
          await prisma.user.update({
            where: { id: user.id },
            data: { emailPending: targetEmail, emailVerifiedAt: null },
          });
        }

        if (!targetEmail) {
          return NextResponse.json(
            { error: 'An email address is required for verification.' },
            { status: 400 }
          );
        }

        if (!deviceId) {
          return NextResponse.json(
            { error: 'Device information is required for verification.' },
            { status: 400 }
          );
        }

        const challenge = await createAuthChallenge({
          userId: user.id,
          purpose: 'ADMIN_EMAIL_VERIFY',
          email: targetEmail,
          deviceId,
        });

        const verifyUrl = buildVerifyUrl(challenge.token);
        const emailContent = buildVerifyLinkEmail({
          kind: 'ADMIN_EMAIL_VERIFY',
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

        console.log('[mobile-login] Sent admin email verification challenge', {
          userId: user.id,
          challengeId: challenge.id,
        });

        return NextResponse.json({
          ok: true,
          requiresEmailVerification: true,
          challengeId: challenge.id,
        });
      }

      if (!deviceId) {
        return NextResponse.json(
          { error: 'Device information is required to continue.' },
          { status: 400 }
        );
      }

      const trusted = await isDeviceTrusted(user.id, deviceId);
      if (!trusted) {
        if (!user.email) {
          return NextResponse.json(
            { error: 'Admin email is missing. Please contact support.' },
            { status: 400 }
          );
        }

        const challenge = await createAuthChallenge({
          userId: user.id,
          purpose: 'LOGIN_NEW_DEVICE',
          email: user.email,
          deviceId,
        });

        const verifyUrl = buildVerifyUrl(challenge.token);
        const emailContent = buildVerifyLinkEmail({
          kind: 'LOGIN_NEW_DEVICE',
          verifyUrl,
          appUrl,
          username: user.username,
          deviceLabel,
        });

        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          replyTo: REPLY_TO,
        });

        console.log('[mobile-login] Sent admin new device challenge', {
          userId: user.id,
          challengeId: challenge.id,
        });

        return NextResponse.json({
          ok: true,
          requiresEmailVerification: true,
          challengeId: challenge.id,
        });
      }

      await touchTrustedDevice(user.id, deviceId);
      const token = createTokenForUser(sessionUser);
      console.log('[mobile-login] Admin login successful', { userId: user.id });
      return NextResponse.json({ ok: true, token, role: user.role, cloudEnabled });
    }

    if (user.email2faEnabled) {
      if (!user.email || !user.emailVerifiedAt) {
        return NextResponse.json(
          { error: 'Email verification is required before using 2FA.' },
          { status: 400 }
        );
      }
      if (!deviceId) {
        return NextResponse.json(
          { error: 'Device information is required to continue.' },
          { status: 400 }
        );
      }

      const trusted = await isDeviceTrusted(user.id, deviceId);
      if (!trusted) {
        const challenge = await createAuthChallenge({
          userId: user.id,
          purpose: 'LOGIN_NEW_DEVICE',
          email: user.email,
          deviceId,
        });
        const verifyUrl = buildVerifyUrl(challenge.token);
        const emailContent = buildVerifyLinkEmail({
          kind: 'LOGIN_NEW_DEVICE',
          verifyUrl,
          appUrl,
          username: user.username,
          deviceLabel,
        });
        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          replyTo: REPLY_TO,
        });

        console.log('[mobile-login] Sent tenant new device challenge', {
          userId: user.id,
          challengeId: challenge.id,
        });

        return NextResponse.json({
          ok: true,
          requiresEmailVerification: true,
          challengeId: challenge.id,
        });
      }

      await touchTrustedDevice(user.id, deviceId);
      const token = createTokenForUser(sessionUser);
      console.log('[mobile-login] Tenant 2FA login successful', { userId: user.id });
      return NextResponse.json({ ok: true, token, role: user.role, cloudEnabled });
    }

    if (deviceId) {
      await touchTrustedDevice(user.id, deviceId);
    }
    const token = createTokenForUser(sessionUser);
    console.log('[mobile-login] Tenant login successful', { userId: user.id });
    return NextResponse.json({ ok: true, token, role: user.role, cloudEnabled });
  } catch (err) {
    console.error('[mobile-login] Login error', err);
    return NextResponse.json(
      { error: 'We couldn’t log you in right now. Please try again in a moment.' },
      { status: 500 }
    );
  }
}
