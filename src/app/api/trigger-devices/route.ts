import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { requireUserFromRequest } from '@/lib/apiGuards';
import { getTriggerDeviceDashboardContextForTenant } from '@/lib/triggerDevices';
import { safeLog } from '@/lib/safeLogger';

export async function GET(req: NextRequest) {
  let me;
  try {
    me = await requireUserFromRequest(req);
  } catch {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (me.role === Role.ADMIN) {
    return NextResponse.json({ error: 'Admin dashboards are observe-only.' }, { status: 403 });
  }

  try {
    const fresh = req.nextUrl.searchParams.get('fresh') === '1';
    const data = await getTriggerDeviceDashboardContextForTenant({ userId: me.id, fresh });
    return NextResponse.json(data);
  } catch (err) {
    safeLog('error', '[api/trigger-devices] Failed to load trigger devices', { error: err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Dinodia Hub did not respond when loading trigger devices.' },
      { status: 502 }
    );
  }
}
