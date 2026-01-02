import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { decryptBootstrapSecret } from '@/lib/hubTokens';

export class HubInstallError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'HubInstallError';
  }
}

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function verifyBootstrapClaim(serialRaw: string, bootstrapSecretRaw: string) {
  const serial = (serialRaw || '').trim();
  const bootstrapSecret = (bootstrapSecretRaw || '').trim();
  if (!serial || !bootstrapSecret) {
    throw new HubInstallError('Serial and bootstrap secret are required.', 400);
  }

  const hubInstall = await prisma.hubInstall.findUnique({ where: { serial } });
  if (!hubInstall) {
    throw new HubInstallError('That serial is not provisioned.', 404);
  }
  if (hubInstall.homeId) {
    throw new HubInstallError('This hub is already claimed.', 409);
  }

  const storedSecret = decryptBootstrapSecret(hubInstall.bootstrapSecretCiphertext);
  if (!safeEqual(storedSecret, bootstrapSecret)) {
    throw new HubInstallError('Serial or secret is incorrect.', 401);
  }

  return hubInstall;
}
