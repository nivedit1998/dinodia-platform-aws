import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type SessionSnapshot = {
  beforeDeviceIds: Prisma.JsonValue | null;
  afterDeviceIds: Prisma.JsonValue | null;
  beforeEntityIds: Prisma.JsonValue | null;
  afterEntityIds: Prisma.JsonValue | null;
};

export type TenantOwnedTargets = {
  deviceIds: string[];
  entityIds: string[];
  skippedDeviceIds: number;
  skippedEntityIds: number;
};

function normalizeAutomationId(raw: string) {
  return raw.trim().replace(/^automation\./i, '');
}

function dedupeIds(ids: string[]) {
  return Array.from(
    new Set(
      ids
        .map((id) => normalizeAutomationId(id))
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
}

export function toStringSet(value: Prisma.JsonValue | null | undefined) {
  const result = new Set<string>();
  if (!value || !Array.isArray(value)) return result;
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    result.add(trimmed);
  }
  return result;
}

function isCoreOrNativeDeviceId(id: string) {
  const normalized = id.trim().toLowerCase();
  return (
    normalized.startsWith('core_') ||
    normalized.startsWith('core.') ||
    normalized.startsWith('native_') ||
    normalized.startsWith('native.')
  );
}

function capIds(ids: string[], max: number | undefined) {
  if (!max || max <= 0) return { ids, skipped: 0 };
  if (ids.length <= max) return { ids, skipped: 0 };
  return { ids: ids.slice(0, max), skipped: ids.length - max };
}

export function collectTenantOwnedTargetsFromSessions(
  sessions: SessionSnapshot[],
  opts: { maxRegistryRemovals?: number } = {}
): TenantOwnedTargets {
  const deviceIds = new Set<string>();
  const entityIds = new Set<string>();

  for (const session of sessions) {
    const beforeDevices = toStringSet(session.beforeDeviceIds);
    const afterDevices = toStringSet(session.afterDeviceIds);
    const beforeEntities = toStringSet(session.beforeEntityIds);
    const afterEntities = toStringSet(session.afterEntityIds);

    afterDevices.forEach((id) => {
      if (!beforeDevices.has(id) && !isCoreOrNativeDeviceId(id)) {
        deviceIds.add(id);
      }
    });
    afterEntities.forEach((id) => {
      if (!beforeEntities.has(id)) {
        entityIds.add(id);
      }
    });
  }

  const sanitizedDevices = Array.from(deviceIds)
    .map((id) => id.trim())
    .filter(Boolean);
  const sanitizedEntities = Array.from(entityIds)
    .map((id) => id.trim())
    .filter(Boolean);

  const cappedDevices = capIds(sanitizedDevices, opts.maxRegistryRemovals);
  const cappedEntities = capIds(sanitizedEntities, opts.maxRegistryRemovals);

  return {
    deviceIds: cappedDevices.ids,
    entityIds: cappedEntities.ids,
    skippedDeviceIds: cappedDevices.skipped,
    skippedEntityIds: cappedEntities.skipped,
  };
}

export async function getTenantOwnedTargetsForUser(userId: number, haConnectionId: number) {
  const sessions = await prisma.newDeviceCommissioningSession.findMany({
    where: {
      userId,
      haConnectionId,
      user: { role: Role.TENANT },
    },
    select: {
      beforeDeviceIds: true,
      afterDeviceIds: true,
      beforeEntityIds: true,
      afterEntityIds: true,
    },
  });
  return collectTenantOwnedTargetsFromSessions(sessions);
}

export async function getTenantOwnedTargetsForHome(homeId: number, haConnectionId: number, opts: { maxRegistryRemovals?: number } = {}) {
  const sessions = await prisma.newDeviceCommissioningSession.findMany({
    where: {
      haConnectionId,
      user: { homeId, role: Role.TENANT },
    },
    select: {
      beforeDeviceIds: true,
      afterDeviceIds: true,
      beforeEntityIds: true,
      afterEntityIds: true,
    },
  });
  return collectTenantOwnedTargetsFromSessions(sessions, opts);
}

export async function getTenantAutomationIdsForHome(homeId: number) {
  const [createdByTenantRows, ownershipRows] = await Promise.all([
    prisma.homeAutomation.findMany({
      where: {
        homeId,
        createdByUser: { role: Role.TENANT },
      },
      select: { automationId: true },
    }),
    prisma.automationOwnership.findMany({
      where: {
        homeId,
        user: { role: Role.TENANT },
      },
      select: { automationId: true },
    }),
  ]);

  return dedupeIds([
    ...createdByTenantRows.map((row) => row.automationId),
    ...ownershipRows.map((row) => row.automationId),
  ]);
}

export async function getAutomationIdsForTenant(homeId: number, tenantUserId: number) {
  const [createdRows, ownershipRows] = await Promise.all([
    prisma.homeAutomation.findMany({
      where: {
        homeId,
        createdByUserId: tenantUserId,
      },
      select: { automationId: true },
    }),
    prisma.automationOwnership.findMany({
      where: {
        homeId,
        userId: tenantUserId,
      },
      select: { automationId: true },
    }),
  ]);

  return dedupeIds([
    ...createdRows.map((row) => row.automationId),
    ...ownershipRows.map((row) => row.automationId),
  ]);
}
