import { Prisma, StepUpPurpose } from '@prisma/client';
import { prisma } from './prisma';

type Client = Prisma.TransactionClient | typeof prisma;

export async function createStepUpApproval(
  userId: number,
  deviceId: string,
  purpose: StepUpPurpose,
  client: Client = prisma
) {
  return client.stepUpApproval.create({
    data: {
      userId,
      deviceId,
      purpose,
    },
  });
}

export async function consumeStepUpApproval(
  userId: number,
  deviceId: string,
  purpose: StepUpPurpose,
  client: Client = prisma
) {
  const existing = await client.stepUpApproval.findFirst({
    where: { userId, deviceId, purpose, usedAt: null },
    orderBy: { approvedAt: 'desc' },
  });
  if (!existing) return null;
  return client.stepUpApproval.update({
    where: { id: existing.id },
    data: { usedAt: new Date() },
  });
}
