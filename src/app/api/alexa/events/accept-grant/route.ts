import { NextRequest, NextResponse } from 'next/server';
import { exchangeAcceptGrantCode } from '@/lib/alexaEvents';
import { prisma } from '@/lib/prisma';
import { getUserFromAuthorizationHeader } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const secretHeader = req.headers.get('x-internal-secret');
  if (!secretHeader || secretHeader !== process.env.ALEXA_EVENTS_INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authHeader = req.headers.get('authorization');
  const user = await getUserFromAuthorizationHeader(authHeader);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = body?.code;
  if (!code) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  }

  const tokenPayload = await exchangeAcceptGrantCode(code);
  await prisma.alexaEventToken.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiresAt: new Date(tokenPayload.expiresAt),
    },
    update: {
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiresAt: new Date(tokenPayload.expiresAt),
    },
  });

  return NextResponse.json({ ok: true });
}
