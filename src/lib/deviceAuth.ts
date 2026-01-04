import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getKioskAuthFromRequest } from './auth';
import { prisma } from './prisma';
import { DeviceBlockedError, ensureActiveDevice } from './deviceRegistry';

export type DeviceHeaderInfo = {
  deviceId: string | null;
  deviceLabel: string | null;
};

export class TrustedDeviceError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

const TRUST_ERROR_MESSAGE = 'This device is not trusted. Please sign in again.';

export function readDeviceHeaders(req: NextRequest): DeviceHeaderInfo {
  const clean = (value: string | null) => {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    deviceId: clean(req.headers.get('x-device-id')),
    deviceLabel: clean(req.headers.get('x-device-label')),
  };
}

export function toTrustedDeviceResponse(err: unknown): NextResponse | null {
  if (err instanceof TrustedDeviceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}

export async function requireKioskDeviceSession(req: NextRequest): Promise<{
  user: { id: number; username: string; role: Role };
  deviceId: string;
}> {
  const kioskAuth = await getKioskAuthFromRequest(req);
  if (!kioskAuth) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 401);
  }

  const { user, deviceId, sessionVersion } = kioskAuth;
  if (!deviceId) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 401);
  }

  await ensureActiveDevice(deviceId);

  const trusted = (await prisma.trustedDevice.findUnique({
    where: { userId_deviceId: { userId: user.id, deviceId } },
  })) as unknown as { revokedAt?: Date | null; sessionVersion?: number | null } | null;

  if (!trusted || trusted.revokedAt !== null) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 403);
  }

  const currentVersion = Number(trusted.sessionVersion ?? 0);
  if (currentVersion !== Number(sessionVersion ?? 0)) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 401);
  }

  return { user, deviceId };
}

export async function requireTrustedAdminDevice(req: NextRequest, userId: number): Promise<void> {
  const { deviceId } = readDeviceHeaders(req);
  const kioskAuth = await getKioskAuthFromRequest(req);
  if (kioskAuth) {
    // Enforce kiosk session checks (device active + trusted + sessionVersion match).
    const session = await requireKioskDeviceSession(req);
    if (session.user.id !== userId) {
      throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 401);
    }
    return;
  }

  if (!deviceId) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 401);
  }

  try {
    await ensureActiveDevice(deviceId);
  } catch (err) {
    const status = err instanceof DeviceBlockedError ? 403 : 401;
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, status);
  }

  const trusted = await prisma.trustedDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId } },
    select: { revokedAt: true },
  });
  if (!trusted) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 401);
  }
  if (trusted.revokedAt) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE, 403);
  }
}

// Alias for installers/other privileged flows.
export async function requireTrustedPrivilegedDevice(req: NextRequest, userId: number): Promise<void> {
  return requireTrustedAdminDevice(req, userId);
}
