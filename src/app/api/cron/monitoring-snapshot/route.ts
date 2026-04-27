import { NextRequest, NextResponse } from 'next/server';
import { captureBoilerTempSnapshotForAllConnections } from '@/lib/boilerMonitoring';
import { captureDailyMonitoringSnapshotForAllConnections } from '@/lib/monitoring';
import { cleanupMonitoringReadings } from '@/lib/monitoringCleanup';

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
    const boilerSummary = await captureBoilerTempSnapshotForAllConnections();
    const energySummary = await captureDailyMonitoringSnapshotForAllConnections();
    let cleanupError: string | null = null;

    try {
      await cleanupMonitoringReadings();
    } catch (err) {
      cleanupError = err instanceof Error ? err.message : 'Monitoring cleanup failed';
      console.error('[cron/monitoring-snapshot] cleanup error', err);
    }

    const degraded =
      (boilerSummary.failedConnections ?? 0) > 0 ||
      (energySummary.failedConnections ?? 0) > 0 ||
      cleanupError !== null;

    if (degraded) {
      console.warn('[cron/monitoring-snapshot] completed with partial failures', {
        boilerFailedConnections: boilerSummary.failedConnections ?? 0,
        energyFailedConnections: energySummary.failedConnections ?? 0,
        cleanupFailed: cleanupError !== null,
      });
    }

    return NextResponse.json({
      ok: true,
      degraded,
      ...energySummary,
      boiler: boilerSummary,
      cleanup: {
        ok: cleanupError === null,
        error: cleanupError,
      },
    });
  } catch (err) {
    console.error('[cron/monitoring-snapshot] error', err);
    return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 });
  }
}
