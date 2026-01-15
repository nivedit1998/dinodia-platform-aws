import { NextRequest, NextResponse } from 'next/server';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  const authUser = await resolveAlexaAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
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
    const linked = !!refreshToken;
    return NextResponse.json({ linked });
  } catch (err) {
    console.error('[api/alexa/link-status] error', err);
    return NextResponse.json(
      { error: 'Unable to check Alexa link status right now.' },
      { status: 500 }
    );
  }
}
