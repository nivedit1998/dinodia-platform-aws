import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function parseTimestamp(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.ALEXA_SKILL_EVENTS_INTERNAL_SECRET;
  if (!secret) return NextResponse.json({ error: 'Not configured' }, { status: 500 });

  const token = getBearerToken(req);
  if (token !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const obj = body as Record<string, unknown>;
  const alexaUserId = typeof obj.alexaUserId === 'string' ? obj.alexaUserId.trim() : '';
  if (!alexaUserId) return NextResponse.json({ error: 'Missing alexaUserId' }, { status: 400 });

  const requestId = typeof obj.requestId === 'string' ? obj.requestId.trim() : null;
  const eventAt = parseTimestamp(obj.timestamp);

  const link = await prisma.alexaSkillUserLink.findUnique({
    where: { alexaUserId },
    select: { userId: true, lastEventAt: true },
  });
  if (!link) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'no_mapping' });
  }

  if (eventAt && link.lastEventAt && eventAt.getTime() < link.lastEventAt.getTime()) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'stale' });
  }

  const reason = 'SKILL_ACCOUNT_UNLINKED';
  const clientId = process.env.ALEXA_CLIENT_ID ?? '';

  await prisma.$transaction(async (tx) => {
    await tx.alexaSkillUserLink.update({
      where: { alexaUserId },
      data: {
        disabledAt: new Date(),
        disabledReason: reason,
        lastEventAt: eventAt ?? undefined,
        lastEventRequestId: requestId ?? undefined,
      },
    });
    await tx.alexaRefreshToken.updateMany({
      where: { userId: link.userId, ...(clientId ? { clientId } : {}), revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });
    await tx.alexaEventToken.deleteMany({ where: { userId: link.userId } });
  });

  return NextResponse.json({ ok: true });
}
