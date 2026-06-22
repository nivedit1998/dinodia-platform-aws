import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { CommissioningKind, MatterCommissioningStatus, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findSessionForUser, shapeSessionResponse } from '@/lib/matterSessions';
import { checkCommissionedDeviceVisibility } from '@/lib/tenantDashboardVisibility';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params;
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  if (!sessionId) {
    return apiFailFromStatus(400, 'Missing session id');
  }

  const session = await findSessionForUser(sessionId, me.id, { kind: CommissioningKind.DISCOVERY });
  if (!session) {
    return apiFailFromStatus(404, 'Session not found');
  }

  let resolvedSession = session;
  if (session.status === MatterCommissioningStatus.IN_PROGRESS) {
    const visibility = await checkCommissionedDeviceVisibility({
      userId: me.id,
      newDeviceIds: Array.isArray(session.afterDeviceIds)
        ? session.afterDeviceIds.filter((value): value is string => typeof value === 'string')
        : [],
      newEntityIds: Array.isArray(session.afterEntityIds)
        ? session.afterEntityIds.filter((value): value is string => typeof value === 'string')
        : [],
      fresh: true,
    });
    if (visibility.visible) {
      resolvedSession = await prisma.newDeviceCommissioningSession.update({
        where: { id: session.id },
        data: {
          status: MatterCommissioningStatus.SUCCEEDED,
          error: null,
        },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    session: shapeSessionResponse(resolvedSession),
  });
}
