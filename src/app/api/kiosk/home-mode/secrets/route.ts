import { NextRequest, NextResponse } from 'next/server';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireKioskDeviceSession } from '@/lib/deviceAuth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireKioskDeviceSession(req);
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
