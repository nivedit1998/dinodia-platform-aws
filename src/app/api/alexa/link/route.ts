import { NextRequest, NextResponse } from 'next/server';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { captureAlexaEndpointSnapshot, pushAlexaDiscoveryDiff } from '@/lib/alexaDiscoverySync';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rateLimit';
import { Role } from '@prisma/client';
import { logServerError } from '@/lib/serverErrorLog';
import { safeLog } from '@/lib/safeLogger';

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
    const tenant = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { homeId: true },
    });
    const beforeAlexa =
      tenant?.homeId != null
        ? await captureAlexaEndpointSnapshot({
            homeId: tenant.homeId,
            tenantUserIds: [authUser.id],
          }).catch((err) => {
            safeLog('warn', '[api/alexa/link] Failed to capture Alexa snapshot before unlink', {
              userId: authUser.id,
              err,
            });
            return new Map();
          })
        : new Map();

    await prisma.$transaction(async (tx) => {
      await tx.alexaRefreshToken.updateMany({
        where: { userId: authUser.id, revoked: false },
        data: { revoked: true, revokedAt: new Date() },
      });
      await tx.alexaEventToken.deleteMany({ where: { userId: authUser.id } });
      await tx.alexaSkillUserLink.updateMany({
        where: { userId: authUser.id },
        data: { disabledAt: new Date(), disabledReason: 'DINODIA_DISCONNECT' },
      });
    });

    if (beforeAlexa.size > 0) {
      await pushAlexaDiscoveryDiff({
        before: beforeAlexa,
        after: new Map([[authUser.id, { endpoints: [], endpointIds: [] }]]),
      }).catch((err) => {
        safeLog('warn', '[api/alexa/link] Failed to push Alexa DeleteReport after unlink', {
          userId: authUser.id,
          err,
        });
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logServerError('[api/alexa/link] unlink error', err, { userId: authUser.id });
    return NextResponse.json(
      { error: 'Unable to disconnect Alexa right now. Please try again.' },
      { status: 500 }
    );
  }
}
