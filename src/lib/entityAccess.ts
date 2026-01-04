import { Role } from '@prisma/client';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';

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
  const devices = await getDevicesForHaConnection(haConnectionId, {
    cacheTtlMs: options?.cacheTtlMs,
    bypassCache: options?.bypassCache,
  });

  const device = devices.find((d) => d.entityId === entityId);
  const status = options?.notFoundStatus ?? 403;
  if (!device || !device.areaName || !allowedAreas.has(device.areaName)) {
    throw new EntityAccessError('You are not allowed to access that device.', status);
  }
}
