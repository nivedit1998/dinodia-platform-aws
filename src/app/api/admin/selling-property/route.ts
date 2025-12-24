import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, HomeStatus, Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type SellingPropertyMode = 'FULL_RESET' | 'OWNER_TRANSFER';

type SellingPropertyRequest = {
  mode?: SellingPropertyMode;
};

type SellingPropertyResponse = {
  ok: true;
  claimCode: string;
};

function errorResponse(message: string, status = 400, extras: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extras }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentUser();
    if (!me || me.role !== Role.ADMIN) {
      return errorResponse('Your session has ended. Please sign in again.', 401);
    }

    let body: SellingPropertyRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid request. Please try again.');
    }

    const mode = body?.mode;
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
        type: AuditEventType.SELL_INITIATED,
        homeId: home.id,
        actorUserId: me.id,
        metadata: { mode },
      },
    });
    await prisma.auditEvent.create({
      data: {
        type: AuditEventType.CLAIM_CODE_GENERATED,
        homeId: home.id,
        actorUserId: me.id,
        metadata: { mode },
      },
    });

    if (mode === 'OWNER_TRANSFER') {
      const deletionResult = await prisma.$transaction(async (tx) => {
        await tx.haConnection.update({
          where: { id: haConnection.id },
          data: { ownerId: null },
        });

        const trustedDevices = await tx.trustedDevice.deleteMany({ where: { userId: me.id } });
        const authChallenges = await tx.authChallenge.deleteMany({ where: { userId: me.id } });
        const accessRules = await tx.accessRule.deleteMany({ where: { userId: me.id } });
        const alexaAuthCodes = await tx.alexaAuthCode.deleteMany({ where: { userId: me.id } });
        const alexaRefreshTokens = await tx.alexaRefreshToken.deleteMany({ where: { userId: me.id } });
        const alexaEventTokens = await tx.alexaEventToken.deleteMany({ where: { userId: me.id } });
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
          },
          guardrails: {
            maxRegistryRemovals: MAX_REGISTRY_REMOVALS,
            skippedDeviceIds: initialTargets.skippedDeviceIds,
            skippedEntityIds: initialTargets.skippedEntityIds,
          },
        },
      },
    });

  let cleanupSummary: HaCleanupSummary;
  try {
    cleanupSummary = await performHaCleanup(haConnection, haConnection.id);
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

  const cloudLogout = await logoutHaCloud(haConnection, cleanupSummary.endpointUsed);

  const dbDeletionResult = await prisma.$transaction(async (tx) => {
    await tx.haConnection.update({
      where: { id: haConnection.id },
      data: { ownerId: null, cloudUrl: null },
      });

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
      const devices = await tx.device.deleteMany({ where: { haConnectionId: haConnection.id } });
      const monitoringReadings = await tx.monitoringReading.deleteMany({
        where: { haConnectionId: haConnection.id },
      });
      const usersDeleted = await tx.user.deleteMany({ where: { id: { in: userIds }, homeId: home.id } });

      await tx.home.update({
        where: { id: home.id },
        data: { status: HomeStatus.UNCLAIMED },
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
      };
    });

    const haErrors = [
      ...cleanupSummary.automations.errors,
      ...cleanupSummary.entities.errors,
      ...cleanupSummary.devices.errors,
    ].slice(0, 8);

    await prisma.auditEvent.create({
      data: {
        type: AuditEventType.HOME_RESET,
        homeId: home.id,
        actorUserId: null,
        metadata: {
          mode,
          actor: actorSnapshot,
          deleted: dbDeletionResult,
        haCleanup: {
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
          },
          homeStatus: HomeStatus.UNCLAIMED,
        },
      },
    });

    return NextResponse.json({ ok: true, claimCode } satisfies SellingPropertyResponse);
  } catch (err) {
    console.error('[selling-property] Failed to process request', err);
    return errorResponse('We could not complete this request. Please try again.', 500);
  }
}
