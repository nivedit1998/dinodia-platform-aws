import { NextRequest, NextResponse } from 'next/server';
import { Role, HomeStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { encryptBootstrapSecret, generateHubToken } from '@/lib/hubTokens';
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

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return NextResponse.json({ error: deviceError.message }, { status: 403 });
  }

  let body: {
    serial?: string;
    haBaseUrl?: string;
    haUsername?: string;
    haPassword?: string;
    haLongLivedToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const serial = body?.serial?.trim();
  const haBaseUrl = body?.haBaseUrl?.trim();
  const haUsername = body?.haUsername?.trim();
  const haPassword = body?.haPassword ?? '';
  const haLongLivedToken = body?.haLongLivedToken?.trim();

  if (!serial || !haBaseUrl || !haUsername || !haPassword || !haLongLivedToken) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }

  let normalizedBaseUrl: string;
  try {
    normalizedBaseUrl = normalizeBaseUrl(haBaseUrl);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const existing = await prisma.hubInstall.findUnique({ where: { serial } });
  if (existing) {
    return NextResponse.json(
      { error: 'That serial is already provisioned. Run a full reset before re-provisioning.' },
      { status: 409 }
    );
  }

  const duplicateToken = await prisma.haConnection.findFirst({
    where: { longLivedTokenHash: hashSecretForLookup(haLongLivedToken) },
    select: { id: true },
  });
  if (duplicateToken) {
    return NextResponse.json(
      { error: 'That Home Assistant token is already linked to a Dinodia hub.' },
      { status: 409 }
    );
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
        cloudUrl: null,
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

  return NextResponse.json({
    ok: true,
    serial,
    bootstrapSecret,
    homeId: result.home.id,
  });
}
