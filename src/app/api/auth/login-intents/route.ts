import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { authenticateWithCredentialsDetailed } from '@/lib/auth';
import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/authErrorCodes';
import { createLoginIntent } from '@/lib/loginIntents';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';

function fail(status: number, errorCode: AuthErrorCode, error: string) {
  return NextResponse.json({ ok: false, errorCode, error }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
    const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel : null;

    if (!username || !password) {
      return fail(
        400,
        AUTH_ERROR_CODES.INVALID_LOGIN_INPUT,
        'Please enter both a username and password.'
      );
    }
    if (!deviceId) {
      return fail(400, AUTH_ERROR_CODES.DEVICE_REQUIRED, 'Device information is required to continue.');
    }

    const ip = getClientIp(req);
    const rateKey = `login-intent:${ip}:${username}`;
    const allowed = await checkRateLimit(rateKey, { maxRequests: 10, windowMs: 60_000 });
    if (!allowed) {
      return fail(
        429,
        AUTH_ERROR_CODES.RATE_LIMITED,
        'Too many login attempts. Please wait a moment and try again.'
      );
    }

    const authResult = await authenticateWithCredentialsDetailed(username, password);
    if (!authResult.ok) {
      if (authResult.reason === 'USERNAME_NOT_FOUND') {
        return fail(
          401,
          AUTH_ERROR_CODES.USERNAME_NOT_FOUND,
          'This username doesn’t exist. Ask your homeowner to create it first.'
        );
      }
      return fail(401, AUTH_ERROR_CODES.INVALID_PASSWORD, 'That password is incorrect. Please try again.');
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      select: {
        id: true,
        username: true,
        role: true,
        mustChangePassword: true,
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
      return fail(404, AUTH_ERROR_CODES.INTERNAL_ERROR, 'We could not find your account. Please try again.');
    }

    const hasVerifiedEmail = Boolean(user.email && user.emailVerifiedAt);
    const isAdminLike = user.role === Role.ADMIN || user.role === Role.INSTALLER;
    const requiresPasswordChange = user.role === Role.TENANT && user.mustChangePassword;
    const requiresEmailVerification = isAdminLike
      ? !user.emailVerifiedAt
      : !hasVerifiedEmail || user.email2faEnabled === false;
    const needsEmailInput = requiresEmailVerification && !(user.emailPending || user.email);
    const cloudEnabled = Boolean(user.home?.haConnection?.cloudUrl?.trim());

    const intent = await createLoginIntent({
      userId: user.id,
      username: user.username,
      role: user.role,
      deviceId,
      deviceLabel,
    });

    return NextResponse.json({
      ok: true,
      role: user.role,
      cloudEnabled,
      loginIntentId: intent.id,
      requiresPasswordChange,
      passwordPolicy: requiresPasswordChange ? { minLength: 8 } : undefined,
      requiresEmailVerification,
      needsEmailInput,
    });
  } catch {
    return fail(
      500,
      AUTH_ERROR_CODES.INTERNAL_ERROR,
      'We couldn’t start this login right now. Please try again in a moment.'
    );
  }
}
