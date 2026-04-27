import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { Role, HomeStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { encryptBootstrapSecret, generateHubToken, cleanupHubTokens } from '@/lib/hubTokens';
import { generateRandomHex } from '@/lib/hubCrypto';
import { buildEncryptedHaSecrets, hashSecretForLookup } from '@/lib/haSecrets';

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Base URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Base URL must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
}

function normalizeCloudUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Cloud URL must be a valid URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Cloud URL must start with https://');
  }
  const host = parsed.hostname.toLowerCase();
  const allowedSuffix = '.dinodiasmartliving.com';
  if (!host.endsWith(allowedSuffix)) {
    throw new Error('Cloud URL must use a dinodiasmartliving.com host.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return apiFailFromStatus(401, 'Installer access required.');
  }

  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return apiFailFromStatus(403, deviceError.message);
  }

  let body: {
    serial?: string;
    haBaseUrl?: string;
    haCloudUrl?: string;
    haUsername?: string;
    haPassword?: string;
    haLongLivedToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return apiFailFromStatus(400, 'Invalid request body.');
  }

  const serial = body?.serial?.trim();
  const haBaseUrl = body?.haBaseUrl?.trim();
  const haCloudUrl = body?.haCloudUrl?.trim();
  const haUsername = body?.haUsername?.trim();
  const haPassword = body?.haPassword ?? '';
  const haLongLivedToken = body?.haLongLivedToken?.trim();

  if (!serial || !haBaseUrl || !haCloudUrl || !haUsername || !haPassword || !haLongLivedToken) {
    return apiFailFromStatus(400, 'All fields are required.');
  }

  let normalizedBaseUrl: string;
  let normalizedCloudUrl: string;
  try {
    normalizedBaseUrl = normalizeBaseUrl(haBaseUrl);
  } catch (err) {
    return apiFailFromStatus(400, (err as Error).message);
  }
  try {
    normalizedCloudUrl = normalizeCloudUrl(haCloudUrl);
  } catch (err) {
    return apiFailFromStatus(400, (err as Error).message);
  }

  const existing = await prisma.hubInstall.findUnique({ where: { serial } });
  if (existing) {
    return apiFailFromStatus(409, 'That serial is already provisioned. Run a full reset before re-provisioning.');
  }

  const duplicateToken = await prisma.haConnection.findFirst({
    where: { longLivedTokenHash: hashSecretForLookup(haLongLivedToken) },
    select: { id: true },
  });
  if (duplicateToken) {
    return apiFailFromStatus(409, 'That Home Assistant token is already linked to a Dinodia hub.');
  }

  const bootstrapSecret = generateRandomHex(24);
  const encryptedBootstrap = encryptBootstrapSecret(bootstrapSecret);
  const encryptedHaSecrets = buildEncryptedHaSecrets({
    haUsername,
    haPassword,
    longLivedToken: haLongLivedToken,
  });

  const result = await prisma.$transaction(async (tx) => {
    const haConnection = await tx.haConnection.create({
      data: {
        baseUrl: normalizedBaseUrl,
        cloudUrl: normalizedCloudUrl,
        longLivedTokenHash: hashSecretForLookup(haLongLivedToken),
        ...encryptedHaSecrets,
      },
    });

    const home = await tx.home.create({
      data: {
        haConnectionId: haConnection.id,
        status: HomeStatus.UNCLAIMED,
        addressLine1: '',
        addressLine2: null,
        city: '',
        state: null,
        postcode: '',
        country: '',
      },
    });

    const hubInstall = await tx.hubInstall.create({
      data: {
        serial,
        bootstrapSecretCiphertext: encryptedBootstrap,
        platformSyncEnabled: true,
        platformSyncIntervalMinutes: 2,
        rotateEveryMinutes: 60,
        graceMinutes: 20,
        homeId: home.id,
      },
    });

    // Seed initial pending hub token (version 1)
    const token = generateHubToken();
    await tx.hubToken.create({
      data: {
        hubInstallId: hubInstall.id,
        version: 1,
        status: 'PENDING',
        tokenHash: token.hash,
        tokenCiphertext: token.ciphertext,
      },
    });

    return { hubInstall, home };
  });

  await cleanupHubTokens(result.hubInstall.id);

  return NextResponse.json({
    ok: true,
    serial,
    bootstrapSecret,
    homeId: result.home.id,
  });
}
