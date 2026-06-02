import { NextRequest, NextResponse } from 'next/server';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rateLimit';
import { Role } from '@prisma/client';
import { logServerError } from '@/lib/serverErrorLog';

export async function GET(req: NextRequest) {
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

  const rateKey = `alexa-link-status:${authUser.id}`;
  const allowed = await checkRateLimit(rateKey, { maxRequests: 20, windowMs: 60_000 });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Slow down. Please retry shortly.' },
      { status: 429 }
    );
  }

  try {
    const refreshToken = await prisma.alexaRefreshToken.findFirst({
      where: { userId: authUser.id, revoked: false },
    });
    const latestSkillLink = await prisma.alexaSkillUserLink.findFirst({
      where: { userId: authUser.id },
      orderBy: { updatedAt: 'desc' },
      select: { disabledReason: true, disabledAt: true },
    });

    const disabled = !!latestSkillLink?.disabledAt;
    const linked = !!refreshToken && !disabled;

    const reason =
      linked
        ? null
        : latestSkillLink?.disabledReason
          ? String(latestSkillLink.disabledReason)
          : null;

    return NextResponse.json({ linked, reason });
  } catch (err) {
    logServerError('[api/alexa/link-status] error', err, { userId: authUser.id });
    return NextResponse.json(
      { error: 'Unable to check Alexa link status right now.' },
      { status: 500 }
    );
  }
}
