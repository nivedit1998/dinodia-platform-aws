import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';

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

  let normalizedCloudUrl: string | null = null;
  if (typeof haCloudUrl === 'string' && haCloudUrl.trim()) {
    try {
      normalizedCloudUrl = normalizeHaBaseUrl(haCloudUrl);
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

  const updateData: {
    haUsername: string;
    baseUrl: string;
    cloudUrl?: string | null;
    haPassword?: string;
    longLivedToken?: string;
  } = {
    haUsername: haUsername.trim(),
    baseUrl: normalizedBaseUrl,
    cloudUrl: normalizedCloudUrl,
  };

  if (typeof haPassword === 'string' && haPassword.length > 0) {
    updateData.haPassword = haPassword;
  }
  if (typeof haLongLivedToken === 'string' && haLongLivedToken.length > 0) {
    updateData.longLivedToken = haLongLivedToken;
  }

  const updated = await prisma.haConnection.update({
    where: { id: haContext.haConnection.id },
    data: updateData,
    select: {
      haUsername: true,
      baseUrl: true,
      cloudUrl: true,
      haPassword: true,
      longLivedToken: true,
    },
  });

  console.log('[ha-settings] Updated HA settings for admin', { userId: me.id });

  return NextResponse.json({
    ok: true,
    haUsername: updated.haUsername ?? '',
    haBaseUrl: updated.baseUrl ?? '',
    haCloudUrl: updated.cloudUrl ?? '',
    hasHaPassword: Boolean(updated.haPassword),
    hasLongLivedToken: Boolean(updated.longLivedToken),
  });
}
