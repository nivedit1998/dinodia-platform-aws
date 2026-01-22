import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { resolveHaLongLivedToken, resolveHaUiCredentials } from '@/lib/haSecrets';
import { computeSupportApproval } from '@/lib/supportRequests';
import { decryptBootstrapSecret } from '@/lib/hubTokens';

function parseHomeId(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ homeId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const { homeId: rawHomeId } = await context.params;
  const homeId = parseHomeId(rawHomeId);
  if (!homeId) {
    return NextResponse.json({ error: 'Invalid home id.' }, { status: 400 });
  }

  const home = await prisma.home.findUnique({
    where: { id: homeId },
    select: {
      id: true,
      createdAt: true,
      hubInstall: {
        select: {
          id: true,
          bootstrapSecretCiphertext: true,
          serial: true,
          lastSeenAt: true,
          createdAt: true,
          platformSyncEnabled: true,
          rotateEveryMinutes: true,
          graceMinutes: true,
          publishedHubTokenVersion: true,
          lastAckedHubTokenVersion: true,
          lastReportedLanBaseUrl: true,
          lastReportedLanBaseUrlAt: true,
        },
      },
      haConnection: {
        select: {
          id: true,
          baseUrl: true,
          cloudUrl: true,
          haUsername: true,
          haUsernameCiphertext: true,
          haPassword: true,
          haPasswordCiphertext: true,
          longLivedToken: true,
          longLivedTokenCiphertext: true,
        },
      },
      users: {
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          accessRules: { select: { area: true } },
          alexaEventToken: { select: { id: true } },
        },
      },
    },
  });

  if (!home || !home.haConnection) {
    return NextResponse.json({ error: 'Home not found.' }, { status: 404 });
  }

  const installedAt = home.hubInstall?.createdAt ?? home.createdAt;

  const latestHomeRequest = await prisma.supportRequest.findFirst({
    where: { homeId, installerUserId: me.id, kind: 'HOME_ACCESS' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, authChallengeId: true },
  });

  let homeAccessApproved = false;
  let homeSupportRequest: {
    requestId: string;
    status: string;
    approvedAt: Date | null;
    validUntil: Date | null;
    expiresAt: Date | null;
  } | null = null;

  if (latestHomeRequest?.authChallengeId) {
    const challenge = await prisma.authChallenge.findUnique({
      where: { id: latestHomeRequest.authChallengeId },
      select: { approvedAt: true, expiresAt: true, consumedAt: true },
    });
    const approval = computeSupportApproval(challenge);
    homeAccessApproved = approval.status === 'APPROVED';
    homeSupportRequest = {
      requestId: latestHomeRequest.id,
      status: approval.status,
      approvedAt: approval.approvedAt,
      validUntil: approval.validUntil,
      expiresAt: approval.expiresAt,
    };
  }

  let creds: {
    haUsername: string;
    haPassword: string;
    baseUrl: string;
    cloudUrl: string | null;
    longLivedToken: string;
    bootstrapSecret?: string;
  };
  try {
    const { haUsername, haPassword } = resolveHaUiCredentials(home.haConnection);
    const { longLivedToken } = resolveHaLongLivedToken(home.haConnection);
    creds = {
      haUsername,
      haPassword,
      baseUrl: home.haConnection.baseUrl,
      cloudUrl: home.haConnection.cloudUrl ?? null,
      longLivedToken,
    };
    if (homeAccessApproved && home.hubInstall?.bootstrapSecretCiphertext) {
      creds.bootstrapSecret = decryptBootstrapSecret(home.hubInstall.bootstrapSecretCiphertext);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const homeowners = home.users
    .filter((u) => u.role === Role.ADMIN)
    .map((u) => ({ email: u.email ?? null, username: u.username }));

  const tenants = home.users
    .filter((u) => u.role === Role.TENANT)
    .map((u) => ({
      email: u.email ?? null,
      username: u.username,
      areas: u.accessRules.map((r) => r.area).filter(Boolean),
    }));

  const alexaEnabled = home.users
    .filter((u) => !!u.alexaEventToken)
    .map((u) => ({ email: u.email ?? null, username: u.username }));

  const users = await Promise.all(
    home.users.map(async (u) => {
      const latestUserReq = await prisma.supportRequest.findFirst({
        where: {
          homeId,
          installerUserId: me.id,
          targetUserId: u.id,
          kind: 'USER_REMOTE_ACCESS',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, authChallengeId: true },
      });

      let supportRequest: {
        requestId: string;
        status: string;
        approvedAt: Date | null;
        validUntil: Date | null;
        expiresAt: Date | null;
      } | null = null;

      if (latestUserReq?.authChallengeId) {
        const ch = await prisma.authChallenge.findUnique({
          where: { id: latestUserReq.authChallengeId },
          select: { approvedAt: true, expiresAt: true, consumedAt: true },
        });
        const approval = computeSupportApproval(ch);
        supportRequest = {
          requestId: latestUserReq.id,
          status: approval.status,
          approvedAt: approval.approvedAt,
          validUntil: approval.validUntil,
          expiresAt: approval.expiresAt,
        };
      }

      return {
        id: u.id,
        username: u.username,
        email: u.email ?? null,
        role: u.role,
        supportRequest,
      };
    })
  );

  const hubStatus = home.hubInstall
    ? {
        serial: home.hubInstall.serial,
        lastSeenAt: home.hubInstall.lastSeenAt,
        platformSyncEnabled: home.hubInstall.platformSyncEnabled,
        rotateEveryMinutes: home.hubInstall.rotateEveryMinutes,
        graceMinutes: home.hubInstall.graceMinutes,
        publishedHubTokenVersion: home.hubInstall.publishedHubTokenVersion,
        lastAckedHubTokenVersion: home.hubInstall.lastAckedHubTokenVersion,
        lastReportedLanBaseUrl: home.hubInstall.lastReportedLanBaseUrl,
        lastReportedLanBaseUrlAt: home.hubInstall.lastReportedLanBaseUrlAt,
        installedAt,
      }
    : { serial: null, lastSeenAt: null, installedAt };

  return NextResponse.json({
    ok: true,
    homeId: home.id,
    installedAt,
    homeAccessApproved,
    credentials: homeAccessApproved ? creds : undefined,
    homeSupportRequest,
    hubStatus,
    homeowners,
    tenants,
    alexaEnabled,
    users,
  });
}
