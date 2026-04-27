import { NextRequest, NextResponse } from 'next/server';
import { Role, SupportAccessScope } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { maskEmailForTenantRoster } from '@/lib/emailMask';
import { computeSupportApproval } from '@/lib/supportRequests';
import { getControllableAreasForUser } from '@/lib/controlAreas';

type SupportMeta = {
  kind: 'HOME_ACCESS' | 'USER_REMOTE_ACCESS';
  requestId: string;
  approvedAt: string;
  validUntil: string;
  scope?: SupportAccessScope | null;
  reason?: string | null;
  requestedBy?: { id: number; username: string; role: 'INSTALLER' } | null;
  canRevoke: boolean;
  viaUser?: { id: number; username: string; role: 'ADMIN' | 'TENANT' } | null;
};

type RosterUser = {
  id: number;
  username: string;
  role: 'ADMIN' | 'TENANT' | 'INSTALLER';
  roleLabel: 'Homeowner' | 'Tenant' | 'Support Agent';
  email: string | null;
  emailMasked: boolean;
  areas: string[];
  support?: SupportMeta | null;
};

const ROLE_LABEL: Record<Role, RosterUser['roleLabel']> = {
  [Role.ADMIN]: 'Homeowner',
  [Role.INSTALLER]: 'Support Agent',
  [Role.TENANT]: 'Tenant',
};

const sanitizeAreas = (areas: Array<{ area: string }>): string[] => {
  const out = new Set<string>();
  for (const entry of areas) {
    const val = (entry.area || '').trim();
    if (val) out.add(val);
  }
  return Array.from(out);
};

const intersect = (a: string[], b: Set<string>) => a.filter((x) => b.has(x));

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const tenant = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      homeId: true,
      accessRules: { select: { area: true } },
    },
  });

  if (!tenant || !tenant.homeId) {
    return NextResponse.json(
      { error: 'This account is not linked to a home.' },
      { status: 400 }
    );
  }

  const tenantAreas = sanitizeAreas(tenant.accessRules);
  const tenantAreaSet = new Set(tenantAreas);

  const homeUsers = await prisma.user.findMany({
    where: { homeId: tenant.homeId, role: { in: [Role.ADMIN, Role.TENANT] } },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      accessRules: { select: { area: true } },
    },
  });

  const supportRequests = await prisma.supportRequest.findMany({
    where: {
      homeId: tenant.homeId,
      kind: { in: ['HOME_ACCESS', 'USER_REMOTE_ACCESS'] },
      revokedAt: null,
    },
    select: {
      id: true,
      kind: true,
      installerUserId: true,
      targetUserId: true,
      authChallengeId: true,
      scope: true,
      reason: true,
      createdAt: true,
    },
  });

  const challengeIds = Array.from(new Set(supportRequests.map((r) => r.authChallengeId)));
  const challenges = await prisma.authChallenge.findMany({
    where: { id: { in: challengeIds } },
    select: { id: true, approvedAt: true, consumedAt: true, expiresAt: true },
  });
  const challengeById = new Map(challenges.map((c) => [c.id, c]));

  const installerIds = Array.from(new Set(supportRequests.map((r) => r.installerUserId)));
  const installers = await prisma.user.findMany({
    where: { id: { in: installerIds }, role: Role.INSTALLER },
    select: { id: true, username: true, email: true, role: true },
  });
  const installersById = new Map(installers.map((i) => [i.id, i]));

  const userById = new Map(
    homeUsers.map((u) => [
      u.id,
      {
        ...u,
        areas: sanitizeAreas(u.accessRules),
      },
    ])
  );

  // Helper to compute support grants
  const activeSupportByInstaller = new Map<number, { areas: Set<string>; meta: SupportMeta }>();
  for (const req of supportRequests) {
    const installer = installersById.get(req.installerUserId);
    if (!installer) continue;

    const challenge = challengeById.get(req.authChallengeId);
    const approval = computeSupportApproval(challenge ?? null);
    if (approval.status !== 'APPROVED' || !approval.validUntil) continue;

    const baseAreas = new Set<string>();
    if (req.kind === 'HOME_ACCESS') {
      tenantAreas.forEach((a) => baseAreas.add(a));
    } else if (req.kind === 'USER_REMOTE_ACCESS' && req.targetUserId) {
      const target = userById.get(req.targetUserId);
      if (target && target.role === Role.TENANT) {
        intersect(target.areas, tenantAreaSet).forEach((a) => baseAreas.add(a));
      }
    }
    if (baseAreas.size === 0) continue;

    const existing = activeSupportByInstaller.get(req.installerUserId);
    const meta: SupportMeta = {
      kind: req.kind as SupportMeta['kind'],
      requestId: req.id,
      approvedAt: approval.approvedAt?.toISOString() ?? '',
      validUntil: approval.validUntil?.toISOString() ?? '',
      scope: req.scope,
      reason: req.reason,
      requestedBy: { id: installer.id, username: installer.username, role: 'INSTALLER' },
      canRevoke: true,
      viaUser: req.targetUserId
        ? (() => {
            const target = userById.get(req.targetUserId);
            if (!target || target.role === Role.INSTALLER) return null;
            return { id: target.id, username: target.username, role: target.role };
          })()
        : null,
    };

    if (existing) {
      const existingDate = existing.meta.approvedAt ? new Date(existing.meta.approvedAt) : new Date(0);
      if (req.createdAt > existingDate) {
        activeSupportByInstaller.set(req.installerUserId, { areas: baseAreas, meta });
      } else {
        baseAreas.forEach((a) => existing.areas.add(a));
      }
    } else {
      activeSupportByInstaller.set(req.installerUserId, { areas: baseAreas, meta });
    }
  }

  const users: RosterUser[] = [];

  // Admins and tenants from home
  for (const u of homeUsers) {
    const isSelf = u.id === me.id;
    const controllableAreas = getControllableAreasForUser({
      role: u.role,
      accessRules: sanitizeAreas(u.accessRules),
      tenantAreaSet,
    });
    if (!isSelf && controllableAreas.length === 0) continue;

    const emailMasked = u.role === Role.TENANT && !isSelf;
    const email =
      emailMasked && u.email ? maskEmailForTenantRoster(u.email) : u.email ?? null;

    users.push({
      id: u.id,
      username: u.username,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role],
      email,
      emailMasked,
      areas: controllableAreas,
      support: null,
    });
  }

  // Support agents
  for (const [installerId, grant] of activeSupportByInstaller.entries()) {
    const installer = installersById.get(installerId);
    if (!installer) continue;
    const areas = Array.from(grant.areas).filter((a) => tenantAreaSet.has(a));
    if (areas.length === 0) continue;
    users.push({
      id: installer.id,
      username: installer.username,
      role: Role.INSTALLER,
      roleLabel: ROLE_LABEL[Role.INSTALLER],
      email: installer.email ?? null,
      emailMasked: false,
      areas,
      support: grant.meta,
    });
  }

  // Sorting: admins -> installers -> tenants (self first), then username asc
  users.sort((a, b) => {
    const rank = (role: Role, self: boolean) => {
      if (role === Role.ADMIN) return 0;
      if (role === Role.INSTALLER) return 1;
      if (self) return 2;
      return 3;
    };
    const ra = rank(a.role as Role, a.id === me.id);
    const rb = rank(b.role as Role, b.id === me.id);
    if (ra !== rb) return ra - rb;
    return a.username.localeCompare(b.username);
  });

  users.forEach((u) => u.areas.sort((a, b) => a.localeCompare(b)));

  const uniqueUsers = users.length;
  const uniqueOtherUsers = users.filter((u) => u.id !== me.id).length;

  return NextResponse.json({
    ok: true,
    tenantAreas,
    counts: { uniqueUsers, uniqueOtherUsers },
    users,
  });
}
