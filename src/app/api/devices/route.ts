import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { Role } from '@prisma/client';
import { logApiHit } from '@/lib/requestLog';

export async function GET(req: NextRequest) {
  logApiHit(req, '/api/devices', { fresh: req.nextUrl.searchParams.get('fresh') === '1' });

  const me = await getCurrentUserFromRequest(req);
  if (!me) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const fresh = req.nextUrl.searchParams.get('fresh');
  const bypassCache = fresh === '1';

  let user;
  let haConnection;
  try {
    ({ user, haConnection } = await getUserWithHaConnection(me.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  let devices: Awaited<ReturnType<typeof getDevicesForHaConnection>>;
  try {
    devices = await getDevicesForHaConnection(haConnection.id, { bypassCache });
  } catch (err) {
    console.error('Failed to fetch devices from HA (cloud/base):', err);
    return NextResponse.json(
      { error: 'Dinodia Hub did not respond when loading devices.' },
      { status: 502 }
    );
  }

  // Filter for tenants by allowed areas
  const result =
    user.role === Role.TENANT
      ? devices.filter(
          (d) =>
            d.areaName !== null &&
            user?.accessRules.some((r) => r.area === d.areaName)
        )
      : devices;

  if (process.env.NODE_ENV !== 'production') {
    const interestingLabels = new Set(['Motion Sensor', 'TV', 'Spotify']);
    const sample = result.filter((d) => {
      const labels = Array.isArray(d.labels) ? d.labels : [];
      const candidates = [
        d.label ?? '',
        ...labels,
        d.labelCategory ?? '',
      ].map((lbl) => (lbl ? lbl.toString().trim() : ''));
      return candidates.some((lbl) => interestingLabels.has(lbl));
    });
    if (sample.length > 0) {
      console.log('[api/devices] sample', sample.slice(0, 10));
    }
  }

  return NextResponse.json({ devices: result });
}
