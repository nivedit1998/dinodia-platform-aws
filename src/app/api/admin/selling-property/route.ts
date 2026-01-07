import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, HomeStatus, Role, Prisma } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { setHomeClaimCode } from '@/lib/claimCode';
import {
  collectDinodiaEntityAndDeviceIds,
  HaCleanupConnectionError,
  MAX_REGISTRY_REMOVALS,
  performHaCleanup,
  logoutHaCloud,
  type HaCleanupSummary,
} from '@/lib/haCleanup';
import { prisma } from '@/lib/prisma';
import { buildClaimCodeEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { getAppUrl } from '@/lib/authChallenges';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';
import { resolveHaSecrets } from '@/lib/haSecrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type SellingPropertyMode = 'FULL_RESET' | 'OWNER_TRANSFER';

type SellingPropertyRequest = {
  mode?: SellingPropertyMode;
  cleanup?: 'platform' | 'device';
};

type SellingPropertyResponse =
  | { ok: true; claimCode: string }
  | { ok: true };

const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';

function errorResponse(message: string, status = 400, extras: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extras }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const me = await getCurrentUserFromRequest(req);
    if (!me || me.role !== Role.ADMIN) {
      return errorResponse('Your session has ended. Please sign in again.', 401);
    }

    try {
      await requireTrustedAdminDevice(req, me.id);
    } catch (err) {
      const deviceError = toTrustedDeviceResponse(err);
      if (deviceError) return deviceError;
      throw err;
    }

    const admin = await prisma.user.findUnique({
      where: { id: me.id },
      include: { home: { include: { haConnection: true } } },
    });

    if (!admin || !admin.home || !admin.home.haConnection) {
      return errorResponse('Dinodia Hub connection isn’t set up yet for this home.', 400);
    }

    const targets = await collectDinodiaEntityAndDeviceIds(admin.home.haConnection.id);
    const automationIds = await prisma.automationOwnership
      .findMany({ where: { homeId: admin.home.id }, select: { automationId: true } })
      .then((rows) =>
        rows
          .map((row) => (typeof row.automationId === 'string' ? row.automationId.trim() : ''))
          .filter(Boolean)
      );
    return NextResponse.json({ ok: true, targets, automationIds });
  } catch (err) {
    console.error('[selling-property] GET failed', err);
    return errorResponse('We could not fetch cleanup targets. Please try again.', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentUserFromRequest(req);
    if (!me || me.role !== Role.ADMIN) {
      return errorResponse('Your session has ended. Please sign in again.', 401);
    }

    try {
      await requireTrustedAdminDevice(req, me.id);
    } catch (err) {
      const deviceError = toTrustedDeviceResponse(err);
      if (deviceError) return deviceError;
      throw err;
    }

    let body: SellingPropertyRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid request. Please try again.');
    }

    const mode = body?.mode;
    const cleanupMode = body?.cleanup === 'device' ? 'device' : 'platform';
    if (mode !== 'FULL_RESET' && mode !== 'OWNER_TRANSFER') {
      return errorResponse('Choose a selling option to continue.');
    }

    const admin = await prisma.user.findUnique({
      where: { id: me.id },
      include: {
        home: {
          include: { haConnection: true },
        },
      },
    });

    if (!admin || !admin.home || !admin.home.haConnection) {
      return errorResponse('Dinodia Hub connection isn’t set up yet for this home.', 400);
    }

    const home = admin.home;
    const haConnection = admin.home.haConnection;
    const actorSnapshot = { id: me.id, username: admin.username };
    const adminUserIds = await prisma.user
      .findMany({ where: { homeId: home.id, role: Role.ADMIN }, select: { id: true } })
      .then((rows) => rows.map((r) => r.id));
    const hubInstall = await prisma.hubInstall.findFirst({
      where: { homeId: home.id },
      select: { id: true },
    });

    await prisma.auditEvent.create({
      data: {
        type: AuditEventType.SELL_INITIATED,
        homeId: home.id,
        actorUserId: me.id,
        metadata: { mode },
      },
    });
    if (mode === 'FULL_RESET' && adminUserIds.length > 0) {
      await prisma.trustedDevice.updateMany({
        where: { userId: { in: adminUserIds } },
        data: { revokedAt: new Date(), sessionVersion: { increment: 1 } },
      });
    }

    if (mode === 'OWNER_TRANSFER') {
      let claimCode: string;
      try {
        ({ claimCode } = await setHomeClaimCode(home.id));
      } catch (err) {
        return errorResponse(
          err instanceof Error ? err.message : 'We could not generate a claim code. Please try again.',
          500
        );
      }

      await prisma.auditEvent.create({
        data: {
          type: AuditEventType.CLAIM_CODE_GENERATED,
          homeId: home.id,
          actorUserId: me.id,
          metadata: { mode },
        },
      });

      const targetEmail = admin.email || admin.emailPending;
      if (targetEmail) {
        try {
          const appUrl = getAppUrl();
          const emailContent = buildClaimCodeEmail({
            claimCode,
            appUrl,
            username: admin.username,
          });
          await sendEmail({
            to: targetEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
            replyTo: REPLY_TO,
          });
        } catch (err) {
          console.error('[selling-property] Failed to send claim code email', err);
        }
      } else {
        console.warn('[selling-property] Admin email missing; claim code email not sent', {
          adminId: admin.id,
          homeId: home.id,
        });
      }

      const deletionResult = await prisma.$transaction(async (tx) => {
        await tx.haConnection.update({
          where: { id: haConnection.id },
          data: { ownerId: null },
        });

        // Clear step-up/lease rows to avoid FK issues when deleting the admin user.
        await tx.stepUpApproval.deleteMany({ where: { userId: me.id } });
        await tx.remoteAccessLease.deleteMany({ where: { userId: me.id } });

        const trustedDevices = await tx.trustedDevice.deleteMany({ where: { userId: me.id } });
        const authChallenges = await tx.authChallenge.deleteMany({ where: { userId: me.id } });
        const accessRules = await tx.accessRule.deleteMany({ where: { userId: me.id } });
        const alexaAuthCodes = await tx.alexaAuthCode.deleteMany({ where: { userId: me.id } });
        const alexaRefreshTokens = await tx.alexaRefreshToken.deleteMany({ where: { userId: me.id } });
        const alexaEventTokens = await tx.alexaEventToken.deleteMany({ where: { userId: me.id } });
        await tx.automationOwnership.deleteMany({ where: { userId: me.id } });
        const commissioningSessions = await tx.newDeviceCommissioningSession.deleteMany({
          where: { userId: me.id },
        });
        const usersDeleted = await tx.user.deleteMany({ where: { id: me.id, homeId: home.id } });

        await tx.home.update({
          where: { id: home.id },
          data: { status: HomeStatus.TRANSFER_PENDING },
        });

        return {
          trustedDevices: trustedDevices.count,
          authChallenges: authChallenges.count,
          accessRules: accessRules.count,
          alexaAuthCodes: alexaAuthCodes.count,
          alexaRefreshTokens: alexaRefreshTokens.count,
          alexaEventTokens: alexaEventTokens.count,
          commissioningSessions: commissioningSessions.count,
          usersDeleted: usersDeleted.count,
        };
      });

      await prisma.auditEvent.create({
        data: {
          type: AuditEventType.OWNER_TRANSFERRED,
          homeId: home.id,
          actorUserId: null,
          metadata: {
            mode,
            actor: actorSnapshot,
            deleted: {
              users: deletionResult.usersDeleted,
              trustedDevices: deletionResult.trustedDevices,
              authChallenges: deletionResult.authChallenges,
              accessRules: deletionResult.accessRules,
              alexaAuthCodes: deletionResult.alexaAuthCodes,
              alexaRefreshTokens: deletionResult.alexaRefreshTokens,
              alexaEventTokens: deletionResult.alexaEventTokens,
              commissioningSessions: deletionResult.commissioningSessions,
            },
            homeStatus: HomeStatus.TRANSFER_PENDING,
          },
        },
      });

      return NextResponse.json({ ok: true, claimCode } satisfies SellingPropertyResponse);
  }

    const userIds = await prisma.user
      .findMany({ where: { homeId: home.id }, select: { id: true } })
      .then((rows) => rows.map((row) => row.id));

  const initialTargets = await collectDinodiaEntityAndDeviceIds(haConnection.id);
  await prisma.auditEvent.create({
    data: {
      type: AuditEventType.HOME_RESET,
      homeId: home.id,
      actorUserId: me.id,
        metadata: {
          step: 'ha_cleanup_start',
          mode,
          targets: {
            deviceIds: initialTargets.deviceIds.length,
            entityIds: initialTargets.entityIds.length,
            automations: -1, // now deleting all non-notify automations; count is collected during cleanup
          },
          guardrails: {
            maxRegistryRemovals: MAX_REGISTRY_REMOVALS,
            skippedDeviceIds: initialTargets.skippedDeviceIds,
            skippedEntityIds: initialTargets.skippedEntityIds,
          },
        },
      },
    });

  let cleanupSummary: HaCleanupSummary | null = null;
  let cloudLogout: Awaited<ReturnType<typeof logoutHaCloud>> | null = null;
  if (cleanupMode === 'platform') {
    const hydratedHa = { ...haConnection, ...resolveHaSecrets(haConnection) };
    try {
      cleanupSummary = await performHaCleanup(hydratedHa, haConnection.id);
    } catch (err) {
      const payload = {
        step: 'ha_cleanup_failed',
        mode,
        error: err instanceof Error ? err.message : 'Unknown HA cleanup failure',
        reasons: err instanceof HaCleanupConnectionError ? err.reasons : undefined,
      };
      await prisma.auditEvent.create({
        data: {
          type: AuditEventType.HOME_RESET,
          homeId: home.id,
          actorUserId: me.id,
          metadata: payload,
        },
      });

      if (err instanceof HaCleanupConnectionError) {
        return errorResponse(err.message, 400, { reasons: err.reasons });
      }
      return errorResponse('We could not reset this home. Please try again.', 500);
    }

    cloudLogout = await logoutHaCloud(hydratedHa, cleanupSummary.endpointUsed);
  }

    const dbDeletionResult = await prisma.$transaction(async (tx) => {
      const events = await tx.auditEvent.findMany({ where: { homeId: home.id } });
      if (events.length > 0) {
        await tx.auditEventArchive.createMany({
          data: events.map((event) => ({
          type: event.type,
          metadata: event.metadata as Prisma.InputJsonValue,
          homeId: event.homeId ?? null,
          actorUserId: event.actorUserId ?? null,
          createdAt: event.createdAt,
        })),
      });
      await tx.auditEvent.deleteMany({ where: { homeId: home.id } });
    }

      const trustedDevices = await tx.trustedDevice.deleteMany({ where: { userId: { in: userIds } } });
      const authChallenges = await tx.authChallenge.deleteMany({ where: { userId: { in: userIds } } });
      const accessRules = await tx.accessRule.deleteMany({ where: { userId: { in: userIds } } });
      const alexaAuthCodes = await tx.alexaAuthCode.deleteMany({ where: { userId: { in: userIds } } });
      const alexaRefreshTokens = await tx.alexaRefreshToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      const alexaEventTokens = await tx.alexaEventToken.deleteMany({ where: { userId: { in: userIds } } });
      const commissioningSessions = await tx.newDeviceCommissioningSession.deleteMany({
        where: {
          OR: [{ userId: { in: userIds } }, { haConnectionId: haConnection.id }],
        },
      });
      await tx.stepUpApproval.deleteMany({ where: { userId: { in: userIds } } });
      await tx.remoteAccessLease.deleteMany({ where: { userId: { in: userIds } } });
      await tx.automationOwnership.deleteMany({ where: { homeId: home.id } });
      const devices = await tx.device.deleteMany({
        where: {
          haConnectionId: haConnection.id,
          NOT: {
            AND: [
              { label: 'Blind' },
              { blindTravelSeconds: { not: null } },
            ],
          },
        },
      });
      const monitoringReadings = await tx.monitoringReading.deleteMany({
        where: { haConnectionId: haConnection.id },
      });
      const usersDeleted = await tx.user.deleteMany({ where: { id: { in: userIds }, homeId: home.id } });

      if (hubInstall) {
        // Preserve hub pairing and tokens so the agent remains connected after reset.
        await tx.hubInstall.update({
          where: { id: hubInstall.id },
          data: {
            lastSeenAt: null,
          },
        });
      }

      await tx.haConnection.update({
        where: { id: haConnection.id },
        data: { ownerId: null, cloudUrl: null },
      });
    await tx.home.update({
      where: { id: home.id },
      data: {
        status: 'UNCLAIMED',
        claimCodeHash: null,
        claimCodeIssuedAt: null,
        claimCodeConsumedAt: null,
      },
    });

    return {
      trustedDevices: trustedDevices.count,
      authChallenges: authChallenges.count,
      accessRules: accessRules.count,
      alexaAuthCodes: alexaAuthCodes.count,
      alexaRefreshTokens: alexaRefreshTokens.count,
      alexaEventTokens: alexaEventTokens.count,
      commissioningSessions: commissioningSessions.count,
      devices: devices.count,
      monitoringReadings: monitoringReadings.count,
      usersDeleted: usersDeleted.count,
      archivedEvents: events.length,
    };
  });

  // Log summary to console for observability since audit rows are removed.
  const haErrors =
    cleanupSummary
      ? [
          ...cleanupSummary.automations.errors,
          ...cleanupSummary.entities.errors,
          ...cleanupSummary.devices.errors,
        ].slice(0, 8)
      : [];
  console.log('[selling-property] FULL_RESET complete', {
    homeId: home.id,
    actor: actorSnapshot,
    deleted: dbDeletionResult,
    haCleanup: cleanupSummary
      ? {
          endpoint: cleanupSummary.endpointUsed,
          cloudLogout,
          targets: {
            automations: cleanupSummary.targets.automations.length,
            deviceIds: cleanupSummary.targets.deviceIds.length,
            entityIds: cleanupSummary.targets.entityIds.length,
          },
          results: {
            automationsDeleted: cleanupSummary.automations.deleted,
            automationsFailed: cleanupSummary.automations.failed,
            entitiesRemoved: cleanupSummary.entities.removed,
            entityFailures: cleanupSummary.entities.failed,
            devicesRemoved: cleanupSummary.devices.removed,
            deviceFailures: cleanupSummary.devices.failed,
          },
          guardrails: {
            maxRegistryRemovals: cleanupSummary.guardrails.maxRegistryRemovals,
            skippedDeviceIds: cleanupSummary.guardrails.skippedDeviceIds,
            skippedEntityIds: cleanupSummary.guardrails.skippedEntityIds,
            entitiesSkippedBySanitizer: cleanupSummary.entities.skipped,
            devicesSkippedBySanitizer: cleanupSummary.devices.skipped,
          },
          errors: haErrors,
        }
      : null,
  });

  return NextResponse.json({ ok: true } satisfies SellingPropertyResponse);
} catch (err) {
  console.error('[selling-property] Failed to process request', err);
  return errorResponse('We could not complete this request. Please try again.', 500);
}
}
