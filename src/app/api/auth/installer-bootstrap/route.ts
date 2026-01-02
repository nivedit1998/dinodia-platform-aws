import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // If env-managed installer account is configured, disable this endpoint
  if (process.env.INSTALLER_USERNAME && process.env.INSTALLER_PASSWORD && process.env.INSTALLER_EMAIL) {
    return NextResponse.json(
      { error: 'Installer account is centrally managed.' },
      { status: 403 }
    );
  }

  const secret = process.env.INSTALLER_BOOTSTRAP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Installer bootstrap is not configured.' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const bearer =
    authHeader && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice('bearer '.length)
      : null;
  if (!bearer || bearer !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const installerCount = await prisma.user.count({ where: { role: Role.INSTALLER } });
  if (installerCount > 0) {
    return NextResponse.json({ error: 'Installer already exists.' }, { status: 409 });
  }

  let body: { username?: string; password?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const username = body?.username?.trim();
  const password = body?.password ?? '';
  const email = body?.email?.trim() ?? '';

  if (!username || !password || !email) {
    return NextResponse.json({ error: 'username, password, and email are required.' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const installer = await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: Role.INSTALLER,
      email,
      emailVerifiedAt: new Date(),
      emailPending: null,
      email2faEnabled: false,
    },
    select: { id: true, username: true },
  });

  return NextResponse.json({ ok: true, installer: installer.username });
}
