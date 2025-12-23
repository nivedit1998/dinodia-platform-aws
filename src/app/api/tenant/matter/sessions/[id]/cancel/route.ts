import { NextRequest, NextResponse } from 'next/server';
import { MatterCommissioningStatus, Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { resolveHaCloudFirst } from '@/lib/haConnection';
import { abortMatterConfigFlow } from '@/lib/matterConfigFlow';
import { findSessionForUser, shapeSessionResponse } from '@/lib/matterSessions';
import { prisma } from '@/lib/prisma';

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session id' }, { status: 400 });
  }

  let session = await findSessionForUser(sessionId, me.id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (
    session.status === MatterCommissioningStatus.SUCCEEDED ||
    session.status === MatterCommissioningStatus.CANCELED
  ) {
    return NextResponse.json({
      ok: true,
      session: shapeSessionResponse(session),
    });
  }

  if (session.haFlowId) {
    const haConnection = await prisma.haConnection.findUnique({
      where: { id: session.haConnectionId },
      select: { baseUrl: true, cloudUrl: true, longLivedToken: true },
    });
    if (haConnection) {
      const ha = resolveHaCloudFirst(haConnection);
      await abortMatterConfigFlow(ha, session.haFlowId);
    }
  }

  session = await prisma.matterCommissioningSession.update({
    where: { id: session.id },
    data: {
      status: MatterCommissioningStatus.CANCELED,
      error: 'Commissioning was canceled by the user.',
    },
  });

  return NextResponse.json({
    ok: true,
    session: shapeSessionResponse(session),
  });
}
