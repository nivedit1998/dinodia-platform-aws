import { NextRequest, NextResponse } from 'next/server';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';
import { buildEncryptedHaSecrets, hashSecretForLookup } from '@/lib/haSecrets';

function normalizeHaBaseUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('That doesn’t look like a valid Dinodia Hub address. It should start with http:// or https://');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Dinodia Hub addresses must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
}

function normalizeCloudUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Cloud URL must be a valid https:// URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Cloud URL must start with https://');
  }
  const host = parsed.hostname.toLowerCase();
  const allowedSuffix = '.dinodiasmartliving.com';
  if (!host.endsWith(allowedSuffix)) {
    throw new Error('Cloud URL must end with dinodiasmartliving.com');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function ensureAdminWithConnection(adminId: number) {
  try {
    return await getUserWithHaConnection(adminId);
  } catch {
    throw new Error('Dinodia Hub connection isn’t set up yet for this home.');
  }
}

async function guardAdminDevice(req: NextRequest, userId: number) {
  try {
    await requireTrustedAdminDevice(req, userId);
    return null;
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  const deviceError = await guardAdminDevice(req, me.id);
  if (deviceError) return deviceError;

  try {
    const { haConnection } = await ensureAdminWithConnection(me.id);
    return NextResponse.json({
      haUsername: haConnection.haUsername ?? '',
      haBaseUrl: haConnection.baseUrl ?? '',
      haCloudUrl: haConnection.cloudUrl ?? '',
      cloudEnabled: Boolean(haConnection.cloudUrl?.trim()),
      hasHaPassword: Boolean(haConnection.haPassword),
      hasLongLivedToken: Boolean(haConnection.longLivedToken),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'We couldn’t load your Dinodia Hub settings. Please try again.' },
      { status: 400 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  const deviceError = await guardAdminDevice(req, me.id);
  if (deviceError) return deviceError;

  let body: {
    haUsername?: string;
    haPassword?: string;
    haBaseUrl?: string;
    haCloudUrl?: string;
    haLongLivedToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request. Please check the details and try again.' }, { status: 400 });
  }

  const { haUsername, haPassword, haBaseUrl, haCloudUrl, haLongLivedToken } = body ?? {};

  if (typeof haUsername !== 'string' || !haUsername.trim()) {
    return NextResponse.json(
      { error: 'Enter the username you use to sign into your Dinodia Hub.' },
      { status: 400 }
    );
  }
  if (typeof haBaseUrl !== 'string' || !haBaseUrl.trim()) {
    return NextResponse.json(
      { error: 'Enter the local address of your Dinodia Hub (for example, http://homeassistant.local:8123).' },
      { status: 400 }
    );
  }

  let normalizedBaseUrl: string;
  try {
    normalizedBaseUrl = normalizeHaBaseUrl(haBaseUrl);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  if (typeof haCloudUrl === 'string' && haCloudUrl.trim().length > 0) {
    try {
      // Validate early; stored below.
      normalizeCloudUrl(haCloudUrl);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  let haContext;
  try {
    haContext = await ensureAdminWithConnection(me.id);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  const encrypted = buildEncryptedHaSecrets({
    haUsername: haUsername.trim(),
    haPassword:
      typeof haPassword === 'string' && haPassword.length > 0 ? haPassword : undefined,
    longLivedToken:
      typeof haLongLivedToken === 'string' && haLongLivedToken.length > 0
        ? haLongLivedToken
        : undefined,
  });

  const updateData: Prisma.HaConnectionUpdateInput = {
    baseUrl: normalizedBaseUrl,
  };

  if (encrypted.haUsername !== undefined) {
    updateData.haUsername = encrypted.haUsername;
  }
  if (encrypted.haUsernameCiphertext !== undefined) {
    updateData.haUsernameCiphertext = encrypted.haUsernameCiphertext;
  }
  if (encrypted.haPassword !== undefined) {
    updateData.haPassword = encrypted.haPassword;
  }
  if (encrypted.haPasswordCiphertext !== undefined) {
    updateData.haPasswordCiphertext = encrypted.haPasswordCiphertext;
  }
  if (encrypted.longLivedToken !== undefined) {
    updateData.longLivedToken = encrypted.longLivedToken;
  }
  if (encrypted.longLivedTokenCiphertext !== undefined) {
    updateData.longLivedTokenCiphertext = encrypted.longLivedTokenCiphertext;
  }

  if (typeof haLongLivedToken === 'string' && haLongLivedToken.length > 0) {
    updateData.longLivedTokenHash = hashSecretForLookup(haLongLivedToken);
  }

  if (typeof haCloudUrl === 'string' && haCloudUrl.trim().length > 0) {
    try {
      updateData.cloudUrl = normalizeCloudUrl(haCloudUrl);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  const updated = await prisma.haConnection.update({
    where: { id: haContext.haConnection.id },
    data: updateData,
    select: {
      haUsername: true,
      haUsernameCiphertext: true,
      baseUrl: true,
      cloudUrl: true,
      haPassword: true,
      haPasswordCiphertext: true,
      longLivedToken: true,
      longLivedTokenCiphertext: true,
    },
  });

  console.log('[ha-settings] Updated HA settings for admin', { userId: me.id });

  return NextResponse.json({
    ok: true,
    haUsername: updated.haUsername ?? '',
    haBaseUrl: updated.baseUrl ?? '',
    cloudEnabled: Boolean(updated.cloudUrl?.trim()),
    hasHaPassword: Boolean(updated.haPasswordCiphertext ?? updated.haPassword),
    hasLongLivedToken: Boolean(updated.longLivedTokenCiphertext ?? updated.longLivedToken),
  });
}
