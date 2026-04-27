import { Role } from '@prisma/client';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { prisma } from '@/lib/prisma';

export class EntityAccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export function parseEntityId(raw: unknown): { entityId: string; domain: string } {
  if (typeof raw !== 'string') {
    throw new EntityAccessError('Invalid entity id.', 400);
  }
  const trimmed = raw.trim();
  // Conservative HA-like pattern: domain.object_id with letters, numbers, underscores, or hyphens.
  const match = trimmed.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_-]+)$/);
  if (!match) {
    throw new EntityAccessError('Invalid entity id.', 400);
  }
  return { entityId: trimmed, domain: match[1] };
}

type AccessRule = { area: string };

type AssertOpts = {
  notFoundStatus?: number;
  cacheTtlMs?: number;
  bypassCache?: boolean;
};

export async function assertTenantEntityAccess(args: {
  user: { id: number; role: Role };
  accessRules?: AccessRule[] | null;
  haConnectionId: number;
  entityId: string;
  options?: AssertOpts;
}) {
  const { user, accessRules, haConnectionId, entityId, options } = args;
  if (user.role !== Role.TENANT) return;

  const rules = Array.isArray(accessRules) ? accessRules : [];
  const allowedAreas = new Set(rules.map((r) => r.area).filter(Boolean));
  const devicesPromise = getDevicesForHaConnection(haConnectionId, {
    cacheTtlMs: options?.cacheTtlMs,
    bypassCache: options?.bypassCache,
  });
  const homeId = prisma.user
    .findUnique({
      where: { id: user.id },
      select: { homeId: true },
    })
    .then((result) => result?.homeId ?? null);
  const [devices, resolvedHomeId] = await Promise.all([devicesPromise, homeId]);

  const status = options?.notFoundStatus ?? 403;
  if (!resolvedHomeId) {
    throw new EntityAccessError('You are not allowed to access that device.', status);
  }

  const [allTenantOwnedTargets, ownTenantOwnedTargets] = await Promise.all([
    getTenantOwnedTargetsForHome(resolvedHomeId, haConnectionId),
    getTenantOwnedTargetsForUser(user.id, haConnectionId),
  ]);
  const allTenantOwnedEntityIds = new Set(allTenantOwnedTargets.entityIds);
  const ownTenantOwnedEntityIds = new Set(ownTenantOwnedTargets.entityIds);

  if (ownTenantOwnedEntityIds.has(entityId)) {
    return;
  }

  if (allTenantOwnedEntityIds.has(entityId)) {
    throw new EntityAccessError('You are not allowed to access that device.', status);
  }

  const device = devices.find((d) => d.entityId === entityId);
  if (!device || !device.areaName || !allowedAreas.has(device.areaName)) {
    throw new EntityAccessError('You are not allowed to access that device.', status);
  }
}
