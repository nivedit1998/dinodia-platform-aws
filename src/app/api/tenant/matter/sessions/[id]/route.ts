import { NextRequest, NextResponse } from 'next/server';
import { CommissioningKind, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { findSessionForUser, shapeSessionResponse } from '@/lib/matterSessions';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params;
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session id' }, { status: 400 });
  }

  const session = await findSessionForUser(sessionId, me.id, { kind: CommissioningKind.MATTER });
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    session: shapeSessionResponse(session),
  });
}
