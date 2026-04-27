import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { AuditEventType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { resolveHaLongLivedToken, resolveHaUiCredentials } from '@/lib/haSecrets';
import { requireActiveHomeAccess, requireActiveUserAccess } from '@/lib/supportRequests';
import { decryptBootstrapSecret } from '@/lib/hubTokens';
import { getPolicyNotificationDeliveryStatus } from '@/lib/homeownerPolicyNotifications';

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
    return apiFailFromStatus(401, 'Installer access required.');
  }

  const { homeId: rawHomeId } = await context.params;
  const homeId = parseHomeId(rawHomeId);
  if (!homeId) {
    return apiFailFromStatus(400, 'Invalid home id.');
  }

  const homeSummary = await prisma.home.findUnique({
    where: { id: homeId },
    select: {
      id: true,
      haConnectionId: true,
      createdAt: true,
      hubInstall: {
        select: {
          createdAt: true,
        },
      },
    },
  });

  if (!homeSummary || !homeSummary.haConnectionId) {
    return apiFailFromStatus(404, 'Home not found.');
  }

  const installedAt = homeSummary.hubInstall?.createdAt ?? homeSummary.createdAt;
  const homeAccess = await requireActiveHomeAccess({
    prisma,
    homeId,
    installerUserId: me.id,
  });
  const homeAccessApproved = !!homeAccess.active;
  const homeSupportRequest = homeAccess.latest
    ? {
        requestId: homeAccess.latest.requestId,
        status: homeAccess.latest.status,
        approvedAt: homeAccess.latest.approvedAt,
        validUntil: homeAccess.latest.validUntil,
        expiresAt: homeAccess.latest.expiresAt,
      }
    : null;
  const homeownerPolicyEmail = await getPolicyNotificationDeliveryStatus(homeId);

  if (!homeAccessApproved) {
    return NextResponse.json({
      ok: true,
      homeId: homeSummary.id,
      installedAt,
      homeAccessApproved: false,
      homeSupportRequest,
      homeownerPolicyEmail,
    });
  }

  const home = await prisma.home.findUnique({
    where: { id: homeId },
    select: {
      id: true,
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
    return apiFailFromStatus(404, 'Home not found.');
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
    if (home.hubInstall?.bootstrapSecretCiphertext) {
      creds.bootstrapSecret = decryptBootstrapSecret(home.hubInstall.bootstrapSecretCiphertext);
    }
  } catch (err) {
    console.error('[api/installer/home-support/homes/[homeId]] failed to resolve credentials', err);
    return apiFailFromStatus(500, 'Dinodia Hub unavailable. Please refresh and try again.');
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
      const userAccess = await requireActiveUserAccess({
        prisma,
        homeId,
        installerUserId: me.id,
        targetUserId: u.id,
      });

      return {
        id: u.id,
        username: u.username,
        email: u.email ?? null,
        role: u.role,
        supportRequest: userAccess.latest,
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

  const activeHomeSupportRequest = homeSupportRequest?.requestId
    ? await prisma.supportRequest.findUnique({
        where: { id: homeSupportRequest.requestId },
        select: {
          id: true,
          installerUserId: true,
          targetUserId: true,
          scope: true,
          reason: true,
        },
      })
    : null;

  await prisma.auditEvent.create({
    data: {
      type: AuditEventType.SUPPORT_CREDENTIALS_VIEWED,
      homeId,
      actorUserId: me.id,
      metadata: {
        supportRequestId: activeHomeSupportRequest?.id ?? homeSupportRequest?.requestId ?? null,
        targetUserId: activeHomeSupportRequest?.targetUserId ?? null,
        scope: activeHomeSupportRequest?.scope ?? null,
        reason: activeHomeSupportRequest?.reason ?? null,
        installerRequestMismatch:
          activeHomeSupportRequest?.installerUserId != null &&
          activeHomeSupportRequest.installerUserId !== me.id,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    homeId: home.id,
    installedAt,
    homeAccessApproved: true,
    credentials: creds,
    homeSupportRequest,
    hubStatus,
    homeowners,
    tenants,
    alexaEnabled,
    users,
    homeownerPolicyEmail,
  });
}
