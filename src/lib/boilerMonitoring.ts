import { prisma } from '@/lib/prisma';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getGroupLabel } from '@/lib/deviceLabels';
import { getCurrentTemperature, getTargetTemperature } from '@/lib/deviceCapabilities';

const BOILER_LABEL = 'Boiler';
const MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 300;

type ConnectionSnapshotFailure = {
  haConnectionId: number;
  error: string;
};

function normalizeErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : JSON.stringify(err);
  const compact = (raw || 'Unknown error').replace(/\s+/g, ' ').trim();
  return compact.length > MAX_ERROR_LENGTH
    ? `${compact.slice(0, MAX_ERROR_LENGTH)}...`
    : compact;
}

export async function captureBoilerTempSnapshotForConnection(haConnectionId: number, now = new Date()) {
  const devices = await getDevicesForHaConnection(haConnectionId);
  const boilerDevices = devices.filter((d) => getGroupLabel(d) === BOILER_LABEL);

  const readings = boilerDevices
    .map((d) => {
      const attrs = d.attributes ?? {};
      const current = getCurrentTemperature(attrs);
      if (typeof current !== 'number' || !Number.isFinite(current)) return null;
      const target = getTargetTemperature(attrs);
      return {
        haConnectionId,
        entityId: d.entityId,
        numericValue: current,
        currentTemperature: current,
        targetTemperature: typeof target === 'number' && Number.isFinite(target) ? target : null,
        unit: '°C',
        capturedAt: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (readings.length === 0) {
    return { haConnectionId, totalDevices: devices.length, boilerCount: 0, insertedCount: 0 };
  }

  const cutoff = new Date(now.getTime() - MIN_INTERVAL_MS);
  const recent = await prisma.boilerTemperatureReading.findMany({
    where: {
      haConnectionId,
      entityId: { in: readings.map((r) => r.entityId) },
      capturedAt: { gte: cutoff },
    },
    select: { entityId: true },
  });
  const recentSet = new Set(recent.map((r) => r.entityId));
  const data = readings.filter((r) => !recentSet.has(r.entityId));

  const inserted = data.length ? await prisma.boilerTemperatureReading.createMany({ data }) : { count: 0 };

  return {
    haConnectionId,
    totalDevices: devices.length,
    boilerCount: readings.length,
    insertedCount: inserted.count,
  };
}

export async function captureBoilerTempSnapshotForAllConnections(now = new Date()) {
  const connections = await prisma.haConnection.findMany({
    select: { id: true },
  });

  let totalDevices = 0;
  let boilerCount = 0;
  let insertedCount = 0;
  const failures: ConnectionSnapshotFailure[] = [];

  for (const { id } of connections) {
    try {
      const summary = await captureBoilerTempSnapshotForConnection(id, now);
      totalDevices += summary.totalDevices;
      boilerCount += summary.boilerCount;
      insertedCount += summary.insertedCount;
    } catch (err) {
      const message = normalizeErrorMessage(err);
      failures.push({ haConnectionId: id, error: message });
      console.error('[boilerMonitoring] snapshot failed for connection', {
        haConnectionId: id,
        error: message,
      });
    }
  }

  return {
    connections: connections.length,
    totalDevices,
    boilerCount,
    insertedCount,
    failedConnections: failures.length,
    failures,
  };
}
