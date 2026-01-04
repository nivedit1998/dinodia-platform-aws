import { NextRequest, NextResponse } from 'next/server';
import { HubTokenStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptBootstrapSecret, decryptSyncSecret, encryptSyncSecret, getAcceptedTokenHashes, getLatestVersion, generateHubToken } from '@/lib/hubTokens';
import { generateRandomHex, verifyHmac } from '@/lib/hubCrypto';
import { enforceHubReplayProtection, HubReplayError } from '@/lib/hubReplayProtection';

export async function POST(req: NextRequest) {
  let body: { serial?: string; ts?: number; nonce?: string; sig?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { serial, ts, nonce, sig } = body ?? {};
  if (!serial || typeof ts !== 'number' || !nonce || !sig) {
    return NextResponse.json({ error: 'serial, ts, nonce, sig are required.' }, { status: 400 });
  }

  const hubInstall = await prisma.hubInstall.findUnique({ where: { serial: serial.trim() } });
  if (!hubInstall) {
    return NextResponse.json({ error: 'Unknown hub serial.' }, { status: 404 });
  }

  const bootstrapSecret = decryptBootstrapSecret(hubInstall.bootstrapSecretCiphertext);
  try {
    verifyHmac({ serial, ts, nonce, sig }, bootstrapSecret);
    await enforceHubReplayProtection({ serial, nonce, ts });
  } catch (err) {
    if (err instanceof HubReplayError) {
      return NextResponse.json({ error: 'Replay detected' }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
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
