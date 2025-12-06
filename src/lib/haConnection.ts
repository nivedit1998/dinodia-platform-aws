import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { HaConnectionLike } from '@/lib/homeAssistant';

export type ViewMode = 'home' | 'holiday';

const userInclude = {
  haConnection: true,
  ownedHaConnection: true,
  accessRules: true,
} as const;

export async function getUserWithHaConnection(userId: number) {
  let user = await prisma.user.findUnique({
    where: { id: userId },
    include: userInclude,
  });

  if (!user) throw new Error('User not found');

  let haConnection = user.haConnection ?? user.ownedHaConnection;

  if (!haConnection && user.haConnectionId) {
    haConnection = await prisma.haConnection.findUnique({
      where: { id: user.haConnectionId },
    });
  }

  if (!haConnection && user.role === Role.TENANT) {
    const adminWithConnection = await prisma.user.findFirst({
      where: { role: Role.ADMIN },
      select: {
        id: true,
        haConnectionId: true,
        ownedHaConnection: { select: { id: true } },
      },
    });

    const adminHaConnectionId =
      adminWithConnection?.haConnectionId ??
      adminWithConnection?.ownedHaConnection?.id ??
      null;

    if (adminWithConnection && !adminWithConnection.haConnectionId && adminHaConnectionId) {
      await prisma.user.update({
        where: { id: adminWithConnection.id },
        data: { haConnectionId: adminHaConnectionId },
      });
    }

    if (adminHaConnectionId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { haConnectionId: adminHaConnectionId },
      });
      haConnection = await prisma.haConnection.findUnique({
        where: { id: adminHaConnectionId },
      });
      user = await prisma.user.findUnique({
        where: { id: userId },
        include: userInclude,
      });
      if (!user) throw new Error('User not found');
    }
  }

  if (!user || !haConnection) {
    throw new Error('HA connection not configured');
  }

  return { user, haConnection };
}

export function resolveHaForMode(
  haConnection: { baseUrl: string; cloudUrl: string | null; longLivedToken: string },
  mode: ViewMode
): HaConnectionLike {
  const cloud = typeof haConnection.cloudUrl === 'string' ? haConnection.cloudUrl.trim() : '';
  const hasCloud = cloud.length > 0;
  const useCloud = mode === 'holiday' && hasCloud;

  return {
    baseUrl: useCloud ? cloud : haConnection.baseUrl,


    longLivedToken: haConnection.longLivedToken,
  };
}

export function resolveHaCloudFirst(
  haConnection: { baseUrl: string; cloudUrl: string | null; longLivedToken: string }
): HaConnectionLike {
  const cloud = haConnection.cloudUrl?.trim();
  return {
    baseUrl: cloud && cloud.length > 0 ? cloud : haConnection.baseUrl,
    longLivedToken: haConnection.longLivedToken,
  };
}
