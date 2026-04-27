import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { HubTokenStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptBootstrapSecret, decryptSyncSecret, encryptSyncSecret, getAcceptedTokenHashes, getLatestVersion, generateHubToken, cleanupHubTokens } from '@/lib/hubTokens';
import { generateRandomHex, verifyHmac } from '@/lib/hubCrypto';
import { enforceHubReplayProtection, HubReplayError } from '@/lib/hubReplayProtection';

export async function POST(req: NextRequest) {
  let body: { serial?: string; ts?: number; nonce?: string; sig?: string };
  try {
    body = await req.json();
  } catch {
    return apiFailFromStatus(400, 'Invalid body');
  }

  const { serial, ts, nonce, sig } = body ?? {};
  if (!serial || typeof ts !== 'number' || !nonce || !sig) {
    return apiFailFromStatus(400, 'serial, ts, nonce, sig are required.');
  }

  const hubInstall = await prisma.hubInstall.findUnique({ where: { serial: serial.trim() } });
  if (!hubInstall) {
    return apiFailFromStatus(404, 'Unknown hub serial.');
  }

  const bootstrapSecret = decryptBootstrapSecret(hubInstall.bootstrapSecretCiphertext);
  try {
    verifyHmac({ serial, ts, nonce, sig }, bootstrapSecret);
    await enforceHubReplayProtection({ serial, nonce, ts });
  } catch (err) {
    if (err instanceof HubReplayError) {
      return apiFailFromStatus(401, 'Replay detected');
    }
    return apiFailFromStatus(401, 'Invalid hub signature.');
  }

  let syncSecretPlain: string;
  if (!hubInstall.syncSecretCiphertext) {
    syncSecretPlain = generateRandomHex(24);
    const encrypted = encryptSyncSecret(syncSecretPlain);
    await prisma.hubInstall.update({
      where: { id: hubInstall.id },
      data: { syncSecretCiphertext: encrypted, lastSeenAt: new Date() },
    });
  } else {
    syncSecretPlain = decryptSyncSecret(hubInstall.syncSecretCiphertext);
    await prisma.hubInstall.update({
      where: { id: hubInstall.id },
      data: { lastSeenAt: new Date() },
    });
  }

  // Seed a pending token if missing
  const existingTokens = await prisma.hubToken.count({ where: { hubInstallId: hubInstall.id } });
  if (existingTokens === 0) {
    const seed = generateHubToken();
    await prisma.hubToken.create({
      data: {
        hubInstallId: hubInstall.id,
        version: 1,
        status: HubTokenStatus.PENDING,
        tokenHash: seed.hash,
        tokenCiphertext: seed.ciphertext,
      },
    });
    await cleanupHubTokens(hubInstall.id);
  }

  const publishedVersion = hubInstall.publishedHubTokenVersion ?? 0;
  const latestVersion = await getLatestVersion(hubInstall.id);
  const hashes = await getAcceptedTokenHashes(hubInstall.id);

  return NextResponse.json({
    ok: true,
    platformSyncEnabled: hubInstall.platformSyncEnabled,
    platformSyncIntervalMinutes: hubInstall.platformSyncIntervalMinutes,
    syncSecret: syncSecretPlain,
    publishedVersion,
    latestVersion,
    hubTokenHashes: hashes,
  });
}
