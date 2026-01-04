import { NextRequest, NextResponse } from 'next/server';
import { captureMonitoringSnapshotForAllConnections } from '@/lib/monitoring';

const EXPECTED_SECRET = process.env.CRON_SECRET;
const DISABLE_QUERY_SECRET =
  (process.env.DISABLE_CRON_QUERY_SECRET ?? 'true').toLowerCase() === 'true';

export async function GET(req: NextRequest) {
  if (!EXPECTED_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get('authorization');
  const bearerSecret =
    authHeader && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice('bearer '.length)
      : null;
  const secretParam = req.nextUrl.searchParams.get('secret');
  const secret =
    bearerSecret ?? (DISABLE_QUERY_SECRET ? null : secretParam);

  if (secretParam && DISABLE_QUERY_SECRET) {
    console.warn('[cron/monitoring-snapshot] Query param secret rejected; use Authorization header.');
  } else if (secretParam && process.env.NODE_ENV === 'production') {
    console.warn('[cron/monitoring-snapshot] Secret passed via query param; prefer Authorization header.');
  }

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
