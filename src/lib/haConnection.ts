import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export async function getUserWithHaConnection(userId: number) {
  let user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      haConnection: true,
      accessRules: true,
    },
  });

  if (!user) throw new Error('User not found');

  let haConnection = user.haConnection;

  if (!haConnection && user.haConnectionId) {
    haConnection = await prisma.haConnection.findUnique({
      where: { id: user.haConnectionId },
    });
  }

  if (!haConnection && user.role === Role.TENANT) {
    const adminWithConnection = await prisma.user.findFirst({
      where: { role: Role.ADMIN, haConnectionId: { not: null } },
      select: { haConnectionId: true },
    });

    if (adminWithConnection?.haConnectionId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { haConnectionId: adminWithConnection.haConnectionId },
      });
      haConnection = await prisma.haConnection.findUnique({
        where: { id: adminWithConnection.haConnectionId },
      });
      user = await prisma.user.findUnique({
        where: { id: userId },
        include: { haConnection: true, accessRules: true },
      });
    }
  }

  if (!user || !haConnection) {
    throw new Error('HA connection not configured');
  }

  return { user, haConnection };
}
