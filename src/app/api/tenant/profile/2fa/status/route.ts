import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      email: true,
      emailPending: true,
      emailVerifiedAt: true,
      email2faEnabled: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  return NextResponse.json({
    email: user.email,
    emailPending: user.emailPending,
    emailVerifiedAt: user.emailVerifiedAt,
    email2faEnabled: user.email2faEnabled,
  });
}
