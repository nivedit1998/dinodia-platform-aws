import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { computeSupportApproval } from '@/lib/supportRequests';

type Status =
  | 'PENDING'
  | 'APPROVED'
  | 'CONSUMED'
  | 'EXPIRED'
  | 'NOT_FOUND';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return apiFailFromStatus(401, 'Installer access required.');
  }

  const { requestId } = await context.params;
  if (!requestId) {
    return apiFailFromStatus(400, 'Missing request id.');
  }

  const supportRequest = await prisma.supportRequest.findUnique({
    where: { id: requestId },
    select: { authChallengeId: true, installerUserId: true },
  });

  if (!supportRequest || supportRequest.installerUserId !== me.id) {
    return apiFailFromStatus(404, 'Not found.');
  }

  const challenge = await prisma.authChallenge.findUnique({
    where: { id: supportRequest.authChallengeId },
    select: { approvedAt: true, consumedAt: true, expiresAt: true },
  });

  const approval = computeSupportApproval(challenge);

  return NextResponse.json({
    ok: true,
    status: approval.status as Status,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    validUntil: approval.validUntil,
  });
}
