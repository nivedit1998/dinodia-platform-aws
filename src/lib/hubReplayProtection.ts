import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getHmacMaxSkewSeconds } from './hubCrypto';

export class HubReplayError extends Error {}

export async function enforceHubReplayProtection(args: {
  serial: string;
  nonce: string;
  ts: number;
}) {
  const now = new Date();
  const windowSeconds = getHmacMaxSkewSeconds();
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);

  try {
    await prisma.hubAgentNonce.create({
      data: {
        serial: args.serial,
        nonce: args.nonce,
        ts: BigInt(Math.trunc(args.ts)),
        createdAt: now,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new HubReplayError('Replay detected');
    }
    throw err;
  }

  await prisma.hubAgentNonce.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
}
