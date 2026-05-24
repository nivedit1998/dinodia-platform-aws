import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { HubTokenStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  decryptSyncSecret,
  generateHubToken,
  cleanupHubTokens,
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

type HeatingUsageDeviceLabel = 'Boiler' | 'Radiator';

type HeatingUsageDeviceUpdate = {
  label: HeatingUsageDeviceLabel;
  entityId: string;
  onSeconds: number;
  offSeconds: number;
  unknownSeconds: number | null;
  efficiencyWeightedOnSeconds?: number | null;
  efficiencyOnSeconds?: number | null;
  efficiencyBand?: string | null;
  efficiencyBandVersion?: number | null;
  lastSeenAt: string;
  lastWasOn: boolean | null;
  lastWasKnown: boolean | null;
};

type HeatingUsageUpload = {
  schemaVersion: number;
  capturedAt?: string;
  devices?: unknown;
};

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function asNonNegativeInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return null;
  return i;
}

function asNonNegativeFloat(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
}

function normalizeEfficiencyBand(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return null;
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!raw) return null;
  if (!/^[A-G]$/.test(raw)) return null;
  return raw;
}

function normalizeHeatingUsageDeviceUpdate(value: unknown, schemaVersion: number): HeatingUsageDeviceUpdate | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const label = obj.label === 'Boiler' || obj.label === 'Radiator' ? (obj.label as HeatingUsageDeviceLabel) : null;
  const entityId = typeof obj.entityId === 'string' ? obj.entityId.trim() : '';
  const onSeconds = asNonNegativeInt(obj.onSeconds);
  const offSeconds = asNonNegativeInt(obj.offSeconds);
  const unknownSeconds = obj.unknownSeconds === undefined ? null : asNonNegativeInt(obj.unknownSeconds);
  const efficiencyWeightedOnSeconds =
    schemaVersion >= 2 && label === 'Boiler' && obj.efficiencyWeightedOnSeconds !== undefined
      ? asNonNegativeFloat(obj.efficiencyWeightedOnSeconds)
      : null;
  const efficiencyOnSeconds =
    schemaVersion >= 2 && label === 'Boiler' && obj.efficiencyOnSeconds !== undefined
      ? asNonNegativeInt(obj.efficiencyOnSeconds)
      : null;
  const efficiencyBand =
    schemaVersion >= 2 && label === 'Boiler' && obj.efficiencyBand !== undefined
      ? normalizeEfficiencyBand(obj.efficiencyBand)
      : null;
  const efficiencyBandVersion =
    schemaVersion >= 2 && label === 'Boiler' && obj.efficiencyBandVersion !== undefined
      ? asNonNegativeInt(obj.efficiencyBandVersion)
      : null;
  const lastSeenAt = parseIsoDate(obj.lastSeenAt);
  const lastWasOn =
    obj.lastWasOn === null ? null : typeof obj.lastWasOn === 'boolean' ? obj.lastWasOn : null;
  const lastWasKnown =
    obj.lastWasKnown === null ? null : typeof obj.lastWasKnown === 'boolean' ? obj.lastWasKnown : null;

  if (!label || !entityId || !lastSeenAt) return null;
  if (onSeconds === null || offSeconds === null) return null;
  if (obj.unknownSeconds !== undefined && unknownSeconds === null) return null;
  if (schemaVersion >= 2 && label === 'Boiler') {
    if (obj.efficiencyWeightedOnSeconds !== undefined && efficiencyWeightedOnSeconds === null) return null;
    if (obj.efficiencyOnSeconds !== undefined && efficiencyOnSeconds === null) return null;
    if (obj.efficiencyBand !== undefined && efficiencyBand === null) return null;
    if (obj.efficiencyBandVersion !== undefined && efficiencyBandVersion === null) return null;
  }

  return {
    label,
    entityId,
    onSeconds,
    offSeconds,
    unknownSeconds,
    ...(schemaVersion >= 2 && label === 'Boiler'
      ? {
          efficiencyWeightedOnSeconds,
          efficiencyOnSeconds,
          efficiencyBand,
          efficiencyBandVersion,
        }
      : {}),
    lastSeenAt: lastSeenAt.toISOString(),
    lastWasOn,
    lastWasKnown,
  };
}

async function ingestHeatingUsage({
  haConnectionId,
  upload,
}: {
  haConnectionId: number;
  upload: HeatingUsageUpload;
}): Promise<{ processed: number; skipped: number }> {
  const schemaVersion = Number(upload?.schemaVersion ?? 0);
  if (schemaVersion !== 1 && schemaVersion !== 2) return { processed: 0, skipped: 0 };

  const rawDevices = (upload as HeatingUsageUpload)?.devices;
  if (!Array.isArray(rawDevices)) return { processed: 0, skipped: 0 };

  const MAX_DEVICES = 200;
  const normalized = rawDevices
    .slice(0, MAX_DEVICES)
    .map((row) => normalizeHeatingUsageDeviceUpdate(row, schemaVersion))
    .filter(Boolean) as HeatingUsageDeviceUpdate[];

  if (normalized.length === 0) return { processed: 0, skipped: 0 };

  const entityIds = Array.from(new Set(normalized.map((d) => d.entityId)));
  const knownDevices = await prisma.device.findMany({
    where: { haConnectionId, entityId: { in: entityIds } },
    select: { entityId: true, label: true },
  });
  const labelByEntityId = new Map(knownDevices.map((d) => [d.entityId, (d.label || '').trim()]));

  let processed = 0;
  let skipped = 0;

  for (const update of normalized) {
    const dbLabel = (labelByEntityId.get(update.entityId) || '').toLowerCase();
    const expected = update.label.toLowerCase();
    if (dbLabel && dbLabel !== expected) {
      skipped += 1;
      continue;
    }

    const lastSeenAt = new Date(update.lastSeenAt);
    const normalizedLastWasKnown =
      typeof update.lastWasKnown === 'boolean'
        ? update.lastWasKnown
        : typeof update.lastWasOn === 'boolean'
        ? true
        : false;
    const normalizedLastWasOn =
      normalizedLastWasKnown && typeof update.lastWasOn === 'boolean' ? update.lastWasOn : false;
    if (update.label === 'Boiler') {
      const existing = await prisma.boilerUsageAccumulator.findUnique({
        where: { haConnectionId_entityId: { haConnectionId, entityId: update.entityId } },
        select: { lastSeenAt: true },
      });

      if (existing?.lastSeenAt && lastSeenAt.getTime() <= existing.lastSeenAt.getTime()) {
        skipped += 1;
        continue;
      }

      await prisma.boilerUsageAccumulator.upsert({
        where: { haConnectionId_entityId: { haConnectionId, entityId: update.entityId } },
        create: {
          haConnectionId,
          entityId: update.entityId,
          onSeconds: update.onSeconds,
          offSeconds: update.offSeconds,
          unknownSeconds: update.unknownSeconds ?? 0,
          ...(typeof update.efficiencyWeightedOnSeconds === 'number'
            ? { efficiencyWeightedOnSeconds: update.efficiencyWeightedOnSeconds }
            : {}),
          ...(typeof update.efficiencyOnSeconds === 'number'
            ? { efficiencyOnSeconds: update.efficiencyOnSeconds }
            : {}),
          lastSeenAt,
          lastWasOn: normalizedLastWasOn,
          lastWasKnown: normalizedLastWasKnown,
        },
        update: {
          onSeconds: update.onSeconds,
          offSeconds: update.offSeconds,
          ...(update.unknownSeconds !== null ? { unknownSeconds: update.unknownSeconds } : {}),
          ...(typeof update.efficiencyWeightedOnSeconds === 'number'
            ? { efficiencyWeightedOnSeconds: update.efficiencyWeightedOnSeconds }
            : {}),
          ...(typeof update.efficiencyOnSeconds === 'number'
            ? { efficiencyOnSeconds: update.efficiencyOnSeconds }
            : {}),
          lastSeenAt,
          lastWasOn: normalizedLastWasOn,
          lastWasKnown: normalizedLastWasKnown,
        },
      });
      processed += 1;
      continue;
    }

    const existing = await prisma.radiatorUsageAccumulator.findUnique({
      where: { haConnectionId_entityId: { haConnectionId, entityId: update.entityId } },
      select: { lastSeenAt: true },
    });

    if (existing?.lastSeenAt && lastSeenAt.getTime() <= existing.lastSeenAt.getTime()) {
      skipped += 1;
      continue;
    }

    await prisma.radiatorUsageAccumulator.upsert({
      where: { haConnectionId_entityId: { haConnectionId, entityId: update.entityId } },
      create: {
        haConnectionId,
        entityId: update.entityId,
        onSeconds: update.onSeconds,
        offSeconds: update.offSeconds,
        unknownSeconds: update.unknownSeconds ?? 0,
        lastSeenAt,
        lastWasOn: normalizedLastWasOn,
        lastWasKnown: normalizedLastWasKnown,
      },
      update: {
        onSeconds: update.onSeconds,
        offSeconds: update.offSeconds,
        ...(update.unknownSeconds !== null ? { unknownSeconds: update.unknownSeconds } : {}),
        lastSeenAt,
        lastWasOn: normalizedLastWasOn,
        lastWasKnown: normalizedLastWasKnown,
      },
    });
    processed += 1;
  }

  return { processed, skipped };
}

export async function POST(req: NextRequest) {
  let body: {
    serial?: string;
    ts?: number;
    nonce?: string;
    sig?: string;
    agentSeenVersion?: number;
    lanBaseUrl?: string;
    heatingUsage?: HeatingUsageUpload;
    heatingUsageResetAckAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return apiFailFromStatus(400, 'Invalid body');
  }

  const { serial, ts, nonce, sig } = body ?? {};
  const agentSeenVersion = Number(body?.agentSeenVersion ?? 0);
  const reportedLanBaseUrl = normalizeLanBaseUrl(body?.lanBaseUrl);
  const heatingUsageResetAckAt = parseIsoDate(body?.heatingUsageResetAckAt);

  if (!serial || typeof ts !== 'number' || !nonce || !sig) {
    return apiFailFromStatus(400, 'serial, ts, nonce, sig are required.');
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
      heatingUsageResetRequestedAt: true,
      heatingUsageResetCompletedAt: true,
      hubTokens: true,
      homeId: true,
      home: { select: { id: true, haConnectionId: true } },
    },
  });
  if (!hubInstall) {
    return apiFailFromStatus(404, 'Unknown hub serial.');
  }

  if (!hubInstall.syncSecretCiphertext) {
    return apiFailFromStatus(401, 'Hub not paired yet.');
  }

  const syncSecret = decryptSyncSecret(hubInstall.syncSecretCiphertext);
  try {
    verifyHmac({ serial, ts, nonce, sig }, syncSecret);
    await enforceHubReplayProtection({ serial, nonce, ts });
  } catch (err) {
    if (err instanceof HubReplayError) {
      return apiFailFromStatus(401, 'Replay detected');
    }
    return apiFailFromStatus(401, 'Invalid hub signature.');
  }

  const now = new Date();
  await revokeExpiredGraceTokens(hubInstall.id, now);
  await cleanupHubTokens(hubInstall.id);

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
    await cleanupHubTokens(hubInstall.id);
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
      await cleanupHubTokens(hubInstall.id);
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

  const pendingHeatingUsageResetAt =
    hubInstall.heatingUsageResetRequestedAt &&
    (!hubInstall.heatingUsageResetCompletedAt ||
      hubInstall.heatingUsageResetCompletedAt.getTime() < hubInstall.heatingUsageResetRequestedAt.getTime())
      ? hubInstall.heatingUsageResetRequestedAt.toISOString()
      : null;

  // Phase 8: mark hub-side heating usage reset as completed once the hub agent acknowledges it.
  let heatingUsageResetAtForResponse: string | null = pendingHeatingUsageResetAt;
  if (heatingUsageResetAckAt && hubInstall.heatingUsageResetRequestedAt) {
    const requestedAtMs = hubInstall.heatingUsageResetRequestedAt.getTime();
    const ackMs = heatingUsageResetAckAt.getTime();
    const completedMs = hubInstall.heatingUsageResetCompletedAt?.getTime() ?? 0;
    if (ackMs >= requestedAtMs && ackMs > completedMs) {
      await prisma.hubInstall.update({
        where: { id: hubInstall.id },
        data: { heatingUsageResetCompletedAt: heatingUsageResetAckAt },
      });
      heatingUsageResetAtForResponse = null;
    }
  }

  if (hubInstall.home?.haConnectionId && body?.heatingUsage) {
    try {
      const summary = await ingestHeatingUsage({
        haConnectionId: hubInstall.home.haConnectionId,
        upload: body.heatingUsage,
      });
      if (summary.processed > 0 || summary.skipped > 0) {
        console.log('[hub-agent/token-state] Heating usage upload processed', {
          serial,
          haConnectionId: hubInstall.home.haConnectionId,
          processed: summary.processed,
          skipped: summary.skipped,
        });
      }
    } catch (err) {
      console.warn('[hub-agent/token-state] Heating usage upload failed', {
        serial,
        haConnectionId: hubInstall.home.haConnectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let heatingUsageConfig: {
    schemaVersion: number;
    efficiencyBandsVersion: number;
    defaultBoilerEfficiencyBand: string;
    boilerBandsByEntityId: Record<string, string>;
  } | null = null;

  if (hubInstall.home?.haConnectionId) {
    const boilerOverrides = await prisma.device.findMany({
      where: {
        haConnectionId: hubInstall.home.haConnectionId,
        label: 'Boiler',
        boilerEfficiencyBand: { not: null },
      },
      select: { entityId: true, boilerEfficiencyBand: true },
    });
    const map: Record<string, string> = {};
    for (const row of boilerOverrides) {
      const band = typeof row.boilerEfficiencyBand === 'string' ? row.boilerEfficiencyBand.trim().toUpperCase() : '';
      if (/^[A-G]$/.test(band)) map[row.entityId] = band;
    }
    heatingUsageConfig = {
      schemaVersion: 1,
      efficiencyBandsVersion: 1,
      defaultBoilerEfficiencyBand: 'B',
      boilerBandsByEntityId: map,
    };
  }

  return NextResponse.json({
    ok: true,
    platformSyncEnabled: hubInstall.platformSyncEnabled,
    platformSyncIntervalMinutes: hubInstall.platformSyncIntervalMinutes,
    publishedVersion,
    latestVersion,
    hubTokenHashes: hashes,
    heatingUsageResetAt: heatingUsageResetAtForResponse,
    heatingUsageConfig,
  });
}
