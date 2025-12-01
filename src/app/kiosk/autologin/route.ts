import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { authenticateWithCredentials, createSessionForUser } from '@/lib/auth';

const BASIC_AUTH_ENABLED = process.env.ENABLE_BASIC_AUTH_AUTOLOGIN === 'true';
const REALM = 'Dinodia Kiosk';

function unauthorized(message: string) {
  return new NextResponse(message, {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function getRedirectPath(role: Role, requested: string | null) {
  if (requested && requested.startsWith('/')) return requested;
  return role === Role.ADMIN ? '/admin/dashboard' : '/tenant/dashboard';
}

export async function GET(req: NextRequest) {
  if (!BASIC_AUTH_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return unauthorized('Basic authentication required');
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return unauthorized('Invalid authorization header');
  }

  const delimiterIndex = decoded.indexOf(':');
  if (delimiterIndex === -1) {
    return unauthorized('Invalid authorization header');
  }

  const username = decoded.slice(0, delimiterIndex).trim();
  const password = decoded.slice(delimiterIndex + 1);

  const user = await authenticateWithCredentials(username, password);
  if (!user) {
    return unauthorized('Invalid credentials');
  }

  await createSessionForUser(user);

  const redirectPath = getRedirectPath(
    user.role,
    req.nextUrl.searchParams.get('redirect')
  );
  const redirectUrl = new URL(redirectPath, req.nextUrl.origin);

  return NextResponse.redirect(redirectUrl);
}
