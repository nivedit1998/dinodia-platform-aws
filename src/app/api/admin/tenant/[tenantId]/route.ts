import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, Role } from '@prisma/client';
import { apiFailFromStatus } from '@/lib/apiError';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';
import { removeDevicesFromHaRegistry, removeEntitiesFromHaRegistry } from '@/lib/haCleanup';
import { deleteAutomation } from '@/lib/homeAssistantAutomations';
import { prisma } from '@/lib/prisma';
import { getAutomationIdsForTenant, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type UserWithConnection = Awaited<ReturnType<typeof getUserWithHaConnection>>;

function parseTenantId(context: { params: Promise<{ tenantId: string }> }) {
  const raw = context.params;
  return raw.then(({ tenantId }) => {
    const id = Number(tenantId);
    return Number.isInteger(id) && id > 0 ? id : null;
  });
}

function sanitizeAreas(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(cleaned));
}

function safeError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err ?? '');
}

async function deleteTenantAutomations(
  ha: { baseUrl: string; longLivedToken: string },
  automationIds: string[]
) {
  const uniqueIds = Array.from(new Set(automationIds.map((id) => id.trim()).filter(Boolean)));
  const result = {
    attempted: uniqueIds.length,
    deleted: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const automationId of uniqueIds) {
    try {
      await deleteAutomation(ha, automationId);
      result.deleted += 1;
    } catch (err) {
      const message = safeError(err).toLowerCase();
      const isNotFound = message.includes('not found') || message.includes('404');
      if (isNotFound) {
        result.deleted += 1;
      } else {
        result.failed += 1;
        result.errors.push(safeError(err));
      }
    }
  }

  return result;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  try {
    await requireTrustedAdminDevice(req, me.id);
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }

  const tenantId = await parseTenantId(context);
  if (!tenantId) {
    return apiFailFromStatus(400, 'Invalid tenant.');
  }

  let admin: UserWithConnection['user'];
  try {
    ({ user: admin } = await getUserWithHaConnection(me.id));
  } catch {
    return apiFailFromStatus(400, 'Dinodia Hub connection isn’t set up yet for this home.');
  }

  if (!admin.homeId) {
    return apiFailFromStatus(400, 'This account is not linked to a home.');
  }
  const adminHomeId = admin.homeId;

  const tenant = await prisma.user.findFirst({
    where: { id: tenantId, homeId: adminHomeId, role: Role.TENANT },
    select: { id: true, username: true },
  });

  if (!tenant) {
    return apiFailFromStatus(404, 'Tenant not found for this home.');
  }

  const body = (await req.json().catch(() => null)) as { areas?: unknown } | null;
  if (!body || !('areas' in body)) {
    return apiFailFromStatus(400, 'Please provide areas to update.');
  }

  const areas = sanitizeAreas(body.areas);

  await prisma.$transaction(async (tx) => {
    await tx.accessRule.deleteMany({ where: { userId: tenant.id } });
    if (areas.length > 0) {
      await tx.accessRule.createMany({
        data: areas.map((area) => ({ userId: tenant.id, area })),
        skipDuplicates: true,
      });
    }
  });

  return NextResponse.json({
    ok: true,
    tenant: { id: tenant.id, username: tenant.username, areas },
  });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ tenantId: string }> }
) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  try {
    await requireTrustedAdminDevice(req, me.id);
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }

  const tenantId = await parseTenantId(context);
  if (!tenantId) {
    return apiFailFromStatus(400, 'Invalid tenant.');
  }

  let admin: UserWithConnection['user'];
  let haConnection: UserWithConnection['haConnection'];
  try {
    ({ user: admin, haConnection } = await getUserWithHaConnection(me.id));
  } catch {
    return apiFailFromStatus(400, 'Dinodia Hub connection isn’t set up yet for this home.');
  }

  if (!admin.homeId) {
    return apiFailFromStatus(400, 'This account is not linked to a home.');
  }
  const homeId = admin.homeId;

  const tenant = await prisma.user.findFirst({
    where: { id: tenantId, homeId, role: Role.TENANT },
    select: {
      id: true,
      username: true,
      haConnectionId: true,
      accessRules: { select: { area: true } },
    },
  });

  if (!tenant) {
    return apiFailFromStatus(404, 'Tenant not found for this home.');
  }

  if (tenant.haConnectionId && tenant.haConnectionId !== haConnection.id) {
    return apiFailFromStatus(400, 'Tenant is linked to a different home connection.');
  }

  const [automationIds, targets] = await Promise.all([
    getAutomationIdsForTenant(homeId, tenant.id),
    getTenantOwnedTargetsForUser(tenant.id, haConnection.id),
  ]);

  const ha = resolveHaCloudFirst(haConnection);
  const automationResult = await deleteTenantAutomations(ha, automationIds);
  if (automationResult.failed > 0) {
    return apiFailFromStatus(502, 'Dinodia Hub unavailable. Please refresh and try again.');
  }

  const [entityResult, deviceResult] = await Promise.all([
    removeEntitiesFromHaRegistry(ha, targets.entityIds),
    removeDevicesFromHaRegistry(ha, targets.deviceIds),
  ]);
  const registryFailures = entityResult.failed + deviceResult.failed;

  if (registryFailures > 0) {
    return apiFailFromStatus(502, 'Dinodia Hub unavailable. Please refresh and try again.');
  }

  const tenantAreas = Array.from(new Set((tenant.accessRules ?? []).map((rule) => rule.area).filter(Boolean)));

  const deletionResult = await prisma.$transaction(async (tx) => {
    const accessRules = await tx.accessRule.deleteMany({ where: { userId: tenant.id } });
    const trustedDevices = await tx.trustedDevice.deleteMany({ where: { userId: tenant.id } });
    const authChallenges = await tx.authChallenge.deleteMany({ where: { userId: tenant.id } });
    const alexaAuthCodes = await tx.alexaAuthCode.deleteMany({ where: { userId: tenant.id } });
    const alexaRefreshTokens = await tx.alexaRefreshToken.deleteMany({ where: { userId: tenant.id } });
    const alexaEventTokens = await tx.alexaEventToken.deleteMany({ where: { userId: tenant.id } });
    const commissioningSessions = await tx.newDeviceCommissioningSession.deleteMany({
      where: { userId: tenant.id },
    });
    const automationOwnerships = await tx.automationOwnership.deleteMany({
      where: { userId: tenant.id, homeId },
    });
    const homeAutomationRowsDeleted = automationIds.length
      ? await tx.homeAutomation.deleteMany({
          where: {
            homeId,
            automationId: { in: automationIds },
          },
        })
      : { count: 0 };

    await tx.auditEvent.create({
      data: {
        type: AuditEventType.TENANT_DELETED,
        homeId,
        actorUserId: me.id,
        metadata: {
          tenant: {
            id: tenant.id,
            username: tenant.username,
            areas: tenantAreas,
          },
          deleted: {
            accessRules: accessRules.count,
            trustedDevices: trustedDevices.count,
            authChallenges: authChallenges.count,
            automationOwnerships: automationOwnerships.count,
            commissioningSessions: commissioningSessions.count,
            homeAutomationRows: homeAutomationRowsDeleted.count,
            users: 1,
          },
          alexaDeleted: {
            authCodes: alexaAuthCodes.count,
            refreshTokens: alexaRefreshTokens.count,
            eventTokens: alexaEventTokens.count,
          },
          haCleanup: {
            automationsDeleted: automationResult.deleted,
            deviceEntitiesRemoved: entityResult.removed,
            deviceIdsRemoved: deviceResult.removed,
            entityTargets: targets.entityIds.length,
            deviceTargets: targets.deviceIds.length,
            skippedEntityTargets: entityResult.skipped,
            skippedDeviceTargets: deviceResult.skipped,
          },
        },
      },
    });

    const usersDeleted = await tx.user.deleteMany({
      where: { id: tenant.id, homeId },
    });

    return {
      accessRules: accessRules.count,
      trustedDevices: trustedDevices.count,
      authChallenges: authChallenges.count,
      alexaAuthCodes: alexaAuthCodes.count,
      alexaRefreshTokens: alexaRefreshTokens.count,
      alexaEventTokens: alexaEventTokens.count,
      commissioningSessions: commissioningSessions.count,
      automationOwnerships: automationOwnerships.count,
      homeAutomationRows: homeAutomationRowsDeleted.count,
      usersDeleted: usersDeleted.count,
    };
  });

  return NextResponse.json({
    ok: true,
    deleted: deletionResult,
    haCleanup: {
      automationsDeleted: automationResult.deleted,
      entityTargets: targets.entityIds.length,
      deviceTargets: targets.deviceIds.length,
      entitiesRemoved: entityResult.removed,
      devicesRemoved: deviceResult.removed,
      skippedEntities: entityResult.skipped,
      skippedDevices: deviceResult.skipped,
    },
  });
}
