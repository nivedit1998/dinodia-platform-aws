import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { isDeviceTrusted } from './deviceTrust';

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

export async function requireTrustedAdminDevice(req: NextRequest, userId: number): Promise<void> {
  const authHeader = req.headers.get('authorization');
  const usesBearer = !!authHeader && authHeader.toLowerCase().startsWith('bearer ');
  if (!usesBearer) return;

  const { deviceId, deviceLabel } = readDeviceHeaders(req);
  if (!deviceId) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE);
  }

  const trusted = await isDeviceTrusted(userId, deviceId);
  if (!trusted) {
    throw new TrustedDeviceError(TRUST_ERROR_MESSAGE);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[device-auth] Admin bearer request trusted', {
      userId,
      deviceId,
      deviceLabel: deviceLabel ?? undefined,
    });
  }
}

export function toTrustedDeviceResponse(err: unknown): NextResponse | null {
  if (err instanceof TrustedDeviceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
