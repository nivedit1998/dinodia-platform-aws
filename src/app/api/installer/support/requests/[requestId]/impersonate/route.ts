import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import {
  AuthUser,
  createTokenWithExpiry,
  getCurrentUserFromRequest,
  setAuthCookieWithTtl,
} from '@/lib/auth';
import { computeSupportApproval } from '@/lib/supportRequests';

const AUTH_COOKIE_NAME = 'dinodia_token';
const BACKUP_COOKIE_NAME = 'dinodia_installer_backup_token';
const IMPERSONATION_TTL_SECONDS = 60 * 60; // 60 minutes

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const { requestId } = await context.params;
  if (!requestId) {
    return NextResponse.json({ error: 'Missing request id.' }, { status: 400 });
  }

  const supportRequest = await prisma.supportRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      kind: true,
      homeId: true,
      targetUserId: true,
      installerUserId: true,
      authChallengeId: true,
    },
  });

  if (
    !supportRequest ||
    supportRequest.installerUserId !== me.id ||
    supportRequest.kind !== 'USER_REMOTE_ACCESS' ||
    !supportRequest.targetUserId
  ) {
    return NextResponse.json({ error: 'Support request not found.' }, { status: 404 });
  }

  const challenge = await prisma.authChallenge.findUnique({
    where: { id: supportRequest.authChallengeId },
    select: { approvedAt: true, expiresAt: true, consumedAt: true },
  });

  const approval = computeSupportApproval(challenge);
  if (approval.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Support request is not approved or expired.' }, { status: 403 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: supportRequest.targetUserId },
    select: { id: true, username: true, role: true },
  });

  if (!targetUser) {
    return NextResponse.json({ error: 'Target user not found.' }, { status: 404 });
  }

  const cookieStore = await cookies();
  const currentToken = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
  if (!currentToken) {
    return NextResponse.json({ error: 'Missing installer session.' }, { status: 401 });
  }

  // Backup installer session for 60 minutes
  cookieStore.set(BACKUP_COOKIE_NAME, currentToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: IMPERSONATION_TTL_SECONDS,
  });

  const impersonation: AuthUser = {
    id: targetUser.id,
    username: targetUser.username,
    role: targetUser.role,
  };
  const expiresAtIso = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000).toISOString();
  const token = createTokenWithExpiry(impersonation, IMPERSONATION_TTL_SECONDS, {
    installerUserId: me.id,
    supportRequestId: supportRequest.id,
    expiresAt: expiresAtIso,
  });

  await setAuthCookieWithTtl(token, IMPERSONATION_TTL_SECONDS);

  const redirectTo = targetUser.role === Role.ADMIN ? '/admin/dashboard' : '/tenant/dashboard';
  return NextResponse.json({ ok: true, redirectTo });
}
