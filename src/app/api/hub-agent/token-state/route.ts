import { NextRequest, NextResponse } from 'next/server';
import { HubTokenStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  decryptSyncSecret,
  generateHubToken,
  getAcceptedTokenHashes,
  getLatestVersion,
  publishPendingIfAcked,
  revokeExpiredGraceTokens,
} from '@/lib/hubTokens';
import { verifyHmac } from '@/lib/hubCrypto';
import { enforceHubReplayProtection, HubReplayError } from '@/lib/hubReplayProtection';
import { normalizeLanBaseUrl } from '@/lib/lanBaseUrl';

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function POST(req: NextRequest) {
  let body: {
    serial?: string;
    ts?: number;
    nonce?: string;
    sig?: string;
    agentSeenVersion?: number;
    lanBaseUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { serial, ts, nonce, sig } = body ?? {};
  const agentSeenVersion = Number(body?.agentSeenVersion ?? 0);
  const reportedLanBaseUrl = normalizeLanBaseUrl(body?.lanBaseUrl);

  if (!serial || typeof ts !== 'number' || !nonce || !sig) {
    return NextResponse.json({ error: 'serial, ts, nonce, sig are required.' }, { status: 400 });
  }

  const hubInstall = await prisma.hubInstall.findUnique({
    where: { serial: serial.trim() },
    select: {
      id: true,
      serial: true,
      syncSecretCiphertext: true,
      platformSyncEnabled: true,
      platformSyncIntervalMinutes: true,
      rotateEveryMinutes: true,
      graceMinutes: true,
      publishedHubTokenVersion: true,
      lastAckedHubTokenVersion: true,
      hubTokens: true,
      homeId: true,
      home: { select: { id: true, haConnectionId: true } },
    },
  });
  if (!hubInstall) {
    return NextResponse.json({ error: 'Unknown hub serial.' }, { status: 404 });
  }

  if (!hubInstall.syncSecretCiphertext) {
    return NextResponse.json({ error: 'Hub not paired yet.' }, { status: 401 });
  }

  const syncSecret = decryptSyncSecret(hubInstall.syncSecretCiphertext);
  try {
    verifyHmac({ serial, ts, nonce, sig }, syncSecret);
    await enforceHubReplayProtection({ serial, nonce, ts });
  } catch (err) {
    if (err instanceof HubReplayError) {
      return NextResponse.json({ error: 'Replay detected' }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }

  const now = new Date();
  await revokeExpiredGraceTokens(hubInstall.id, now);

  let publishedVersion = hubInstall.publishedHubTokenVersion ?? 0;

  const pending = hubInstall.hubTokens
    .filter((t) => t.status === HubTokenStatus.PENDING)
    .sort((a, b) => a.version - b.version)[0];
  if (pending && agentSeenVersion >= pending.version) {
    publishedVersion = await publishPendingIfAcked(
      hubInstall.id,
      pending.version,
      publishedVersion,
      hubInstall.graceMinutes
    );
  }

  // Seed a pending token if all tokens were wiped (e.g., home reset).
  const pendingToken = await prisma.hubToken.findFirst({
    where: { hubInstallId: hubInstall.id, status: HubTokenStatus.PENDING },
    orderBy: { version: 'asc' },
    select: { id: true, version: true },
  });

  const activeToken = await prisma.hubToken.findFirst({
    where: {
      hubInstallId: hubInstall.id,
      status: HubTokenStatus.ACTIVE,
      publishedAt: { not: null },
    },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, publishedAt: true },
  });

  if (!pendingToken && !activeToken) {
    const seed = generateHubToken();
    try {
      await prisma.hubToken.create({
        data: {
          hubInstallId: hubInstall.id,
          version: 1,
          status: HubTokenStatus.PENDING,
          tokenHash: seed.hash,
          tokenCiphertext: seed.ciphertext,
        },
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
    }
  } else if (!pendingToken && activeToken && hubInstall.platformSyncEnabled) {
    const rotateMinutes = hubInstall.rotateEveryMinutes ?? 60;
    const rotateMs = rotateMinutes * 60 * 1000;
    const ageMs = now.getTime() - new Date(activeToken.publishedAt as Date).getTime();

    if (ageMs >= rotateMs) {
      const latestVersion = await getLatestVersion(hubInstall.id);
      const nextVersion = latestVersion + 1;
      const token = generateHubToken();
      try {
        await prisma.hubToken.create({
          data: {
            hubInstallId: hubInstall.id,
            version: nextVersion,
            status: HubTokenStatus.PENDING,
            tokenHash: token.hash,
            tokenCiphertext: token.ciphertext,
          },
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
      }
    }
  }

  const latestVersion = await getLatestVersion(hubInstall.id);
  const hashes = await getAcceptedTokenHashes(hubInstall.id, now);

  const hubUpdate: Prisma.HubInstallUpdateInput = {
    lastSeenAt: now,
    lastAckedHubTokenVersion: Math.max(agentSeenVersion, hubInstall.lastAckedHubTokenVersion ?? 0),
  };

  if (reportedLanBaseUrl) {
    hubUpdate.lastReportedLanBaseUrl = reportedLanBaseUrl;
    hubUpdate.lastReportedLanBaseUrlAt = now;
  }

  await prisma.$transaction(async (tx) => {
    await tx.hubInstall.update({
      where: { id: hubInstall.id },
      data: hubUpdate,
    });

    if (reportedLanBaseUrl && hubInstall.home?.haConnectionId) {
      await tx.haConnection.update({
        where: { id: hubInstall.home.haConnectionId },
        data: { baseUrl: reportedLanBaseUrl },
      });
    }
  });

  return NextResponse.json({
    ok: true,
    platformSyncEnabled: hubInstall.platformSyncEnabled,
    platformSyncIntervalMinutes: hubInstall.platformSyncIntervalMinutes,
    publishedVersion,
    latestVersion,
    hubTokenHashes: hashes,
  });
}
