import { NextRequest, NextResponse } from 'next/server';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rateLimit';
import { Role } from '@prisma/client';

export async function DELETE(req: NextRequest) {
  const authUser = await resolveAlexaAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (authUser.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Alexa is available to tenant accounts only.' },
      { status: 403 }
    );
  }

  const allowed = await checkRateLimit(`alexa-unlink:${authUser.id}`, {
    maxRequests: 5,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Slow down. Please retry shortly.' },
      { status: 429 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.alexaRefreshToken.updateMany({
        where: { userId: authUser.id, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
      await tx.alexaEventToken.deleteMany({ where: { userId: authUser.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/alexa/link] unlink error', err);
    return NextResponse.json(
      { error: 'Unable to disconnect Alexa right now. Please try again.' },
      { status: 500 }
    );
  }
}
