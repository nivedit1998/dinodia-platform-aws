import { prisma } from '@/lib/prisma';

export async function bumpDevicesVersion(haConnectionId: number): Promise<void> {
  await prisma.haConnection.update({
    where: { id: haConnectionId },
    data: { devicesVersion: { increment: 1 } } as any,
  });
}
