import { NextRequest, NextResponse } from 'next/server';
import { captureMonitoringSnapshotForAllConnections } from '@/lib/monitoring';

const EXPECTED_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!EXPECTED_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    );
  }

  const secret = req.nextUrl.searchParams.get('secret');
  if (!secret || secret !== EXPECTED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await captureMonitoringSnapshotForAllConnections();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[cron/monitoring-snapshot] error', err);
    return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 });
  }
}
