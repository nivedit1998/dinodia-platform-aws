import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, hashPassword, verifyPassword } from '@/lib/auth';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    currentPassword?: string;
    newPassword?: string;
    confirmNewPassword?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { currentPassword, newPassword, confirmNewPassword } = body ?? {};

  if (
    typeof currentPassword !== 'string' ||
    typeof newPassword !== 'string' ||
    typeof confirmNewPassword !== 'string'
  ) {
    return NextResponse.json({ error: 'All password fields are required' }, { status: 400 });
  }

  if (newPassword !== confirmNewPassword) {
    return NextResponse.json({ error: 'New passwords do not match' }, { status: 400 });
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: 'New password must be different from the current password' },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash },
  });

  return NextResponse.json({ ok: true });
}
