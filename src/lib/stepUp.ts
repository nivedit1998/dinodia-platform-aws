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

export async function getLatestStepUpApproval(
  userId: number,
  deviceId: string,
  purpose: StepUpPurpose,
  opts: { maxAgeMs?: number } = {},
  client: Client = prisma
) {
  const maxAgeMs = typeof opts.maxAgeMs === 'number' && opts.maxAgeMs > 0 ? opts.maxAgeMs : undefined;
  const cutoff = maxAgeMs ? new Date(Date.now() - maxAgeMs) : undefined;
  return client.stepUpApproval.findFirst({
    where: {
      userId,
      deviceId,
      purpose,
      usedAt: null,
      ...(cutoff ? { approvedAt: { gte: cutoff } } : {}),
    },
    orderBy: { approvedAt: 'desc' },
  });
}

export async function consumeLatestStepUpApproval(
  userId: number,
  deviceId: string,
  purpose: StepUpPurpose,
  client: Client = prisma
) {
  const latest = await client.stepUpApproval.findFirst({
    where: { userId, deviceId, purpose, usedAt: null },
    orderBy: { approvedAt: 'desc' },
  });
  if (!latest) return null;
  return client.stepUpApproval.update({
    where: { id: latest.id },
    data: { usedAt: new Date() },
  });
}
