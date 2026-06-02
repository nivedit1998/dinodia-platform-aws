import { NextRequest, NextResponse } from 'next/server';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { Role } from '@prisma/client';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { logServerError } from '@/lib/serverErrorLog';

export async function GET(req: NextRequest) {
  const authUser = await resolveAlexaAuthUser(req);
  if (!authUser) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (authUser.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Alexa is available to tenant accounts only.' },
      { status: 403 }
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
    const includeServicesForTarget =
      req.nextUrl.searchParams.get('include_services_for_target') === '1';
    const devices = await getDevicesForHaConnection(haConnection.id, {
      logSample: true,
      // Keep Alexa discovery fast: only fetch labeled entities (same idea as `/api/devices?fresh=1`)
      // and avoid per-entity `get_services_for_target` calls during discovery.
      labelsOnly: true,
      includeServicesForTarget,
      cacheTtlMs: includeServicesForTarget ? 300_000 : 60_000,
    });

    const tenantOwnedForHome = await getTenantOwnedTargetsForHome(user.homeId!, haConnection.id);
    const tenantOwnedForUser = await getTenantOwnedTargetsForUser(user.id, haConnection.id);
    const allTenantOwnedEntityIds = new Set(tenantOwnedForHome.entityIds);
    const ownTenantOwnedEntityIds = new Set(tenantOwnedForUser.entityIds);

    const filteredDevices =
      user.role === Role.TENANT
        ? (() => {
            const allowedAreas = new Set((user.accessRules ?? []).map((rule) => rule.area));
            return devices.filter((device) => {
              if (ownTenantOwnedEntityIds.has(device.entityId)) {
                return true;
              }

              if (allTenantOwnedEntityIds.has(device.entityId)) {
                return false;
              }

              return Boolean(device.areaName && allowedAreas.has(device.areaName));
            });
          })()
        : devices;

    return NextResponse.json({ devices: filteredDevices });
  } catch (err) {
    logServerError('[api/alexa/devices] error', err, { userId: authUser.id });
    return NextResponse.json(
      {
        error:
          'Remote access not enabled, check internet connection or enable via your iOS/Android phone or the Dinodia Kiosk',
      },
      { status: 500 }
    );
  }
}
