import { NextRequest, NextResponse } from 'next/server';
import { resendChallengeEmail } from '@/lib/authChallenges';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ip = getClientIp(req);
  const allowed = await checkRateLimit(`challenge-resend:${id}:${ip}`, {
    maxRequests: 3,
    windowMs: 120_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before resending.' },
      { status: 429 }
    );
  }

  const result = await resendChallengeEmail(id);

  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (result.reason === 'TOO_SOON') {
      return NextResponse.json({ error: 'Please wait before resending.' }, { status: 429 });
    }
    return NextResponse.json(
      { error: 'Unable to resend verification email.', reason: result.reason },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
