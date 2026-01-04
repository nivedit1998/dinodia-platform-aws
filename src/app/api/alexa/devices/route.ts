import { NextRequest, NextResponse } from 'next/server';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { Role } from '@prisma/client';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { checkRateLimit } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  const authUser = await resolveAlexaAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  try {
    const allowed = await checkRateLimit(`alexa-devices:${authUser.id}`, {
      maxRequests: 20,
      windowMs: 60_000,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Slow down. Please retry device discovery shortly.' },
        { status: 429 }
      );
    }

    const { user, haConnection } = await getUserWithHaConnection(authUser.id);
    const devices = await getDevicesForHaConnection(haConnection.id, { logSample: true });

    const filteredDevices =
      user.role === Role.TENANT
        ? devices.filter(
            (device) =>
              device.areaName !== null &&
              user.accessRules.some((rule) => rule.area === device.areaName)
          )
        : devices;

    return NextResponse.json({ devices: filteredDevices });
  } catch (err) {
    console.error('[api/alexa/devices] error', err);
    return NextResponse.json(
      {
        error:
          'Remote access not enabled, check internet connection or enable via your iOS/Android phone or the Dinodia Kiosk',
      },
      { status: 500 }
    );
  }
}
