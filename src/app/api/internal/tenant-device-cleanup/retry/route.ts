import { NextRequest, NextResponse } from 'next/server';
import { cleanupPendingTenantDevices } from '@/lib/tenantDeviceCleanup';

function isAuthorized(req: NextRequest) {
  const configured = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${configured}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await cleanupPendingTenantDevices({ limit: 50 });
  return NextResponse.json({ ok: true, ...result });
}
