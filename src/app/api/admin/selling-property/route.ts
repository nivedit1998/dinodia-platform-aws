import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, HomeStatus, Prisma, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { setHomeClaimCode } from '@/lib/claimCode';
import {
  HaCleanupConnectionError,
  MAX_REGISTRY_REMOVALS,
  logoutHaCloud,
  performTenantOwnedHaCleanup,
  type HaCleanupSummary,
} from '@/lib/haCleanup';
import { prisma } from '@/lib/prisma';
import { buildClaimCodeEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { getAppUrl } from '@/lib/authChallenges';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';
import { resolveHaLongLivedToken } from '@/lib/haSecrets';
import { apiFailPayload } from '@/lib/apiError';
import { getTenantAutomationIdsForHome, getTenantOwnedTargetsForHome } from '@/lib/tenantOwnership';

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
const UNCLAIMED_VALUE = 'UNCLAIMED';

function errorResponse(message: string, status = 400, extras: Record<string, unknown> = {}) {
  return apiFailPayload(status, { error: message, ...extras });
}

function normalizeAutomationId(raw: string) {
  return raw.trim().replace(/^automation\./i, '');
}

async function getAdminContext(adminUserId: number) {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    include: {
      home: {
        include: {
          haConnection: true,
          hubInstall: { select: { id: true } },
        },
      },
    },
  });
  if (!admin || !admin.home || !admin.home.haConnection) {
    return null;
  }
  return admin;
}

async function getFullResetPreview(homeId: number, haConnectionId: number, hubInstallId: string | null) {
  const [users, tenantTargets, tenantAutomationIds] = await Promise.all([
    prisma.user.findMany({
      where: { homeId },
      select: { id: true, role: true },
    }),
    getTenantOwnedTargetsForHome(homeId, haConnectionId, { maxRegistryRemovals: MAX_REGISTRY_REMOVALS }),
    getTenantAutomationIdsForHome(homeId),
  ]);

  const userIds = users.map((user) => user.id);
  const tenantCount = users.filter((user) => user.role === Role.TENANT).length;
  const adminCount = users.filter((user) => user.role === Role.ADMIN).length;
  const hasUsers = userIds.length > 0;
  const targetEntityIds = tenantTargets.entityIds;
  const pendingHomeownerOnboardingWhere = hubInstallId
    ? { OR: [{ homeId }, { hubInstallId }] }
    : { homeId };

  const [
    trustedDevices,
    authChallenges,
    accessRules,
    stepUpApprovals,
    remoteAccessLeases,
    alexaAuthCodes,
    alexaRefreshTokens,
    alexaEventTokens,
    commissioningSessions,
    automationOwnershipRows,
    tenantHomeAutomationRows,
    monitoringReadings,
    boilerTemperatureReadings,
    supportRequests,
    pendingHomeownerOnboardings,
    tenantDeviceOverrides,
    auditEvents,
  ] = await Promise.all([
    hasUsers ? prisma.trustedDevice.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.authChallenge.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.accessRule.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.stepUpApproval.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.remoteAccessLease.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.alexaAuthCode.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.alexaRefreshToken.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.alexaEventToken.count({ where: { userId: { in: userIds } } }) : 0,
    hasUsers ? prisma.newDeviceCommissioningSession.count({ where: { userId: { in: userIds } } }) : 0,
    prisma.automationOwnership.count({ where: { homeId } }),
    tenantAutomationIds.length
      ? prisma.homeAutomation.count({
          where: {
            homeId,
            automationId: { in: tenantAutomationIds },
          },
        })
      : 0,
    prisma.monitoringReading.count({ where: { haConnectionId } }),
    prisma.boilerTemperatureReading.count({ where: { haConnectionId } }),
    prisma.supportRequest.count({ where: { homeId } }),
    prisma.pendingHomeownerOnboarding.count({
      where: pendingHomeownerOnboardingWhere,
    }),
    targetEntityIds.length
      ? prisma.device.count({
          where: {
            haConnectionId,
            entityId: { in: targetEntityIds },
            NOT: {
              AND: [{ label: 'Blind' }, { blindTravelSeconds: { not: null } }],
            },
          },
        })
      : 0,
    prisma.auditEvent.count({ where: { homeId } }),
  ]);

  return {
    haTargets: {
      tenantOwnedDeviceIds: tenantTargets.deviceIds,
      tenantOwnedEntityIds: tenantTargets.entityIds,
      tenantAutomationIds,
      skippedDeviceIds: tenantTargets.skippedDeviceIds,
      skippedEntityIds: tenantTargets.skippedEntityIds,
    },
    dbCounts: {
      users: users.length,
      tenants: tenantCount,
      admins: adminCount,
      trustedDevices,
      authChallenges,
      accessRules,
      stepUpApprovals,
      remoteAccessLeases,
      alexaAuthCodes,
      alexaRefreshTokens,
      alexaEventTokens,
      commissioningSessions,
      automationOwnershipRows,
      tenantHomeAutomationRows,
      tenantDeviceOverrides,
      monitoringReadings,
      boilerTemperatureReadings,
      supportRequests,
      pendingHomeownerOnboardings,
      auditEvents,
    },
  };
}

async function getOwnerTransferPreview(homeId: number, actorUserId: number) {
  const [
    trustedDevices,
    authChallenges,
    accessRules,
    stepUpApprovals,
    remoteAccessLeases,
    alexaAuthCodes,
    alexaRefreshTokens,
    alexaEventTokens,
    commissioningSessions,
    automationOwnershipRows,
    pendingHomeownerOnboardings,
    supportRequests,
  ] = await Promise.all([
    prisma.trustedDevice.count({ where: { userId: actorUserId } }),
    prisma.authChallenge.count({ where: { userId: actorUserId } }),
    prisma.accessRule.count({ where: { userId: actorUserId } }),
    prisma.stepUpApproval.count({ where: { userId: actorUserId } }),
    prisma.remoteAccessLease.count({ where: { userId: actorUserId } }),
    prisma.alexaAuthCode.count({ where: { userId: actorUserId } }),
    prisma.alexaRefreshToken.count({ where: { userId: actorUserId } }),
    prisma.alexaEventToken.count({ where: { userId: actorUserId } }),
    prisma.newDeviceCommissioningSession.count({ where: { userId: actorUserId } }),
    prisma.automationOwnership.count({ where: { homeId, userId: actorUserId } }),
    prisma.pendingHomeownerOnboarding.count({ where: { homeId } }),
    prisma.supportRequest.count({ where: { homeId } }),
  ]);

  return {
    dbCounts: {
      users: 1,
      trustedDevices,
      authChallenges,
      accessRules,
      stepUpApprovals,
      remoteAccessLeases,
      alexaAuthCodes,
      alexaRefreshTokens,
      alexaEventTokens,
      commissioningSessions,
      automationOwnershipRows,
      pendingHomeownerOnboardings,
      supportRequests,
    },
  };
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

    const admin = await getAdminContext(me.id);
    if (!admin) {
      return errorResponse('Dinodia Hub connection isn’t set up yet for this home.', 400);
    }
    const home = admin.home!;

    const [fullReset, ownerTransfer] = await Promise.all([
      getFullResetPreview(home.id, home.haConnection.id, home.hubInstall?.id ?? null),
      getOwnerTransferPreview(home.id, me.id),
    ]);

    return NextResponse.json({
      ok: true,
      fullReset,
      ownerTransfer,
      // Back-compat shape used by existing UI clients.
      targets: {
        deviceIds: fullReset.haTargets.tenantOwnedDeviceIds,
        entityIds: fullReset.haTargets.tenantOwnedEntityIds,
        skippedDeviceIds: fullReset.haTargets.skippedDeviceIds,
        skippedEntityIds: fullReset.haTargets.skippedEntityIds,
      },
      automationIds: fullReset.haTargets.tenantAutomationIds,
    });
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

    const admin = await getAdminContext(me.id);
    if (!admin) {
      return errorResponse('Dinodia Hub connection isn’t set up yet for this home.', 400);
    }

    const home = admin.home!;
    const haConnection = home.haConnection;
    const actorSnapshot = { id: me.id, username: admin.username };

    await prisma.auditEvent.create({
      data: {
        type: AuditEventType.SELL_INITIATED,
        homeId: home.id,
        actorUserId: me.id,
        metadata: { mode, cleanupMode },
      },
    });

    if (mode === 'OWNER_TRANSFER') {
      let claimCode: string;
      try {
        ({ claimCode } = await setHomeClaimCode(home.id));
      } catch {
        return errorResponse('We could not generate a claim code. Please try again.', 500);
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
      }

      const deletionResult = await prisma.$transaction(async (tx) => {
        await tx.haConnection.update({
          where: { id: haConnection.id },
          data: { ownerId: null },
        });

        await tx.stepUpApproval.deleteMany({ where: { userId: me.id } });
        await tx.remoteAccessLease.deleteMany({ where: { userId: me.id } });
        const trustedDevices = await tx.trustedDevice.deleteMany({ where: { userId: me.id } });
        const authChallenges = await tx.authChallenge.deleteMany({ where: { userId: me.id } });
        const accessRules = await tx.accessRule.deleteMany({ where: { userId: me.id } });
        const alexaAuthCodes = await tx.alexaAuthCode.deleteMany({ where: { userId: me.id } });
        const alexaRefreshTokens = await tx.alexaRefreshToken.deleteMany({ where: { userId: me.id } });
        const alexaEventTokens = await tx.alexaEventToken.deleteMany({ where: { userId: me.id } });
        const automationOwnershipRows = await tx.automationOwnership.deleteMany({
          where: { userId: me.id, homeId: home.id },
        });
        const commissioningSessions = await tx.newDeviceCommissioningSession.deleteMany({
          where: { userId: me.id },
        });
        const usersDeleted = await tx.user.deleteMany({ where: { id: me.id, homeId: home.id } });

        await tx.home.update({
          where: { id: home.id },
          data: { status: HomeStatus.ACTIVE },
        });

        return {
          trustedDevices: trustedDevices.count,
          authChallenges: authChallenges.count,
          accessRules: accessRules.count,
          alexaAuthCodes: alexaAuthCodes.count,
          alexaRefreshTokens: alexaRefreshTokens.count,
          alexaEventTokens: alexaEventTokens.count,
          automationOwnershipRows: automationOwnershipRows.count,
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
            deleted: deletionResult,
            homeStatus: HomeStatus.ACTIVE,
          },
        },
      });

      return NextResponse.json({ ok: true, claimCode } satisfies SellingPropertyResponse);
    }

    const [usersInHome, tenantTargets, tenantAutomationIds] = await Promise.all([
      prisma.user.findMany({
        where: { homeId: home.id },
        select: { id: true },
      }),
      getTenantOwnedTargetsForHome(home.id, haConnection.id, { maxRegistryRemovals: MAX_REGISTRY_REMOVALS }),
      getTenantAutomationIdsForHome(home.id),
    ]);
    const homeUserIds = usersInHome.map((user) => user.id);

    await prisma.auditEvent.create({
      data: {
        type: AuditEventType.HOME_RESET,
        homeId: home.id,
        actorUserId: me.id,
        metadata: {
          step: 'ha_cleanup_start',
          mode,
          cleanupMode,
          targets: {
            tenantOwnedDeviceIds: tenantTargets.deviceIds.length,
            tenantOwnedEntityIds: tenantTargets.entityIds.length,
            tenantAutomationIds: tenantAutomationIds.length,
          },
          guardrails: {
            maxRegistryRemovals: MAX_REGISTRY_REMOVALS,
            skippedDeviceIds: tenantTargets.skippedDeviceIds,
            skippedEntityIds: tenantTargets.skippedEntityIds,
          },
        },
      },
    });

    let cleanupSummary: HaCleanupSummary | null = null;
    let cloudLogout: Awaited<ReturnType<typeof logoutHaCloud>> | null = null;
    if (cleanupMode === 'platform') {
      const hydratedHa = { ...haConnection, ...resolveHaLongLivedToken(haConnection) };
      try {
        cleanupSummary = await performTenantOwnedHaCleanup(hydratedHa, {
          deviceIds: tenantTargets.deviceIds,
          entityIds: tenantTargets.entityIds,
          automationIds: tenantAutomationIds,
        });
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
          return errorResponse('Dinodia Hub unavailable. Please refresh and try again.', 400, {
            reasons: err.reasons,
          });
        }
        return errorResponse('We could not reset this home. Please try again.', 500);
      }

      cloudLogout = await logoutHaCloud(hydratedHa, cleanupSummary.endpointUsed);
    }

    const hubInstallId = home.hubInstall?.id ?? null;
    const pendingHomeownerOnboardingWhere = hubInstallId
      ? { OR: [{ homeId: home.id }, { hubInstallId }] }
      : { homeId: home.id };
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

      const trustedDevices = homeUserIds.length
        ? await tx.trustedDevice.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const authChallenges = homeUserIds.length
        ? await tx.authChallenge.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const accessRules = homeUserIds.length
        ? await tx.accessRule.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const alexaAuthCodes = homeUserIds.length
        ? await tx.alexaAuthCode.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const alexaRefreshTokens = homeUserIds.length
        ? await tx.alexaRefreshToken.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const alexaEventTokens = homeUserIds.length
        ? await tx.alexaEventToken.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const commissioningSessions = homeUserIds.length
        ? await tx.newDeviceCommissioningSession.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const stepUpApprovals = homeUserIds.length
        ? await tx.stepUpApproval.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const remoteAccessLeases = homeUserIds.length
        ? await tx.remoteAccessLease.deleteMany({ where: { userId: { in: homeUserIds } } })
        : { count: 0 };
      const automationOwnershipRows = await tx.automationOwnership.deleteMany({ where: { homeId: home.id } });
      const tenantHomeAutomationRows = tenantAutomationIds.length
        ? await tx.homeAutomation.deleteMany({
            where: {
              homeId: home.id,
              automationId: {
                in: tenantAutomationIds.map((automationId) => normalizeAutomationId(automationId)).filter(Boolean),
              },
            },
          })
        : { count: 0 };
      const tenantDeviceOverrides = tenantTargets.entityIds.length
        ? await tx.device.deleteMany({
            where: {
              haConnectionId: haConnection.id,
              entityId: { in: tenantTargets.entityIds },
              NOT: {
                AND: [{ label: 'Blind' }, { blindTravelSeconds: { not: null } }],
              },
            },
          })
        : { count: 0 };
      const monitoringReadings = await tx.monitoringReading.deleteMany({
        where: { haConnectionId: haConnection.id },
      });
      const boilerTemperatureReadings = await tx.boilerTemperatureReading.deleteMany({
        where: { haConnectionId: haConnection.id },
      });
      const supportRequests = await tx.supportRequest.deleteMany({ where: { homeId: home.id } });
      const pendingHomeownerOnboardings = await tx.pendingHomeownerOnboarding.deleteMany({
        where: pendingHomeownerOnboardingWhere,
      });
      const usersDeleted = homeUserIds.length
        ? await tx.user.deleteMany({ where: { id: { in: homeUserIds }, homeId: home.id } })
        : { count: 0 };

      await tx.haConnection.update({
        where: { id: haConnection.id },
        data: { ownerId: null },
      });
      await tx.home.update({
        where: { id: home.id },
        data: {
          status: HomeStatus.UNCLAIMED,
          claimCodeHash: null,
          claimCodeIssuedAt: null,
          claimCodeConsumedAt: null,
          addressLine1: UNCLAIMED_VALUE,
          addressLine2: null,
          city: UNCLAIMED_VALUE,
          state: null,
          postcode: UNCLAIMED_VALUE,
          country: UNCLAIMED_VALUE,
        },
      });

      return {
        trustedDevices: trustedDevices.count,
        authChallenges: authChallenges.count,
        accessRules: accessRules.count,
        stepUpApprovals: stepUpApprovals.count,
        remoteAccessLeases: remoteAccessLeases.count,
        alexaAuthCodes: alexaAuthCodes.count,
        alexaRefreshTokens: alexaRefreshTokens.count,
        alexaEventTokens: alexaEventTokens.count,
        commissioningSessions: commissioningSessions.count,
        automationOwnershipRows: automationOwnershipRows.count,
        tenantHomeAutomationRows: tenantHomeAutomationRows.count,
        tenantDeviceOverrides: tenantDeviceOverrides.count,
        monitoringReadings: monitoringReadings.count,
        boilerTemperatureReadings: boilerTemperatureReadings.count,
        supportRequests: supportRequests.count,
        pendingHomeownerOnboardings: pendingHomeownerOnboardings.count,
        usersDeleted: usersDeleted.count,
        archivedEvents: events.length,
      };
    });

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
      cleanupMode,
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
