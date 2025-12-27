import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { ensureActiveDevice } from '@/lib/deviceRegistry';
import { readDeviceHeaders } from '@/lib/deviceAuth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const { deviceId } = readDeviceHeaders(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'Device id is required.' }, { status: 400 });
  }

  try {
    await ensureActiveDevice(deviceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'This device is blocked.';
    return NextResponse.json({ error: message }, { status: 403 });
  }

  try {
    const { haConnection } = await getUserWithHaConnection(user.id);
    if (!haConnection.longLivedToken || !haConnection.baseUrl) {
      return NextResponse.json(
        { error: 'Dinodia Hub connection is not configured.' },
        { status: 400 }
      );
    }
    return NextResponse.json({
      baseUrl: haConnection.baseUrl,
      longLivedToken: haConnection.longLivedToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to load Dinodia Hub settings.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
