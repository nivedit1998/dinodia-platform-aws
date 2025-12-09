import { prisma } from '@/lib/prisma';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getGroupLabel, OTHER_LABEL } from '@/lib/deviceLabels';

export async function captureMonitoringSnapshotForConnection(haConnectionId: number) {
  const devices = await getDevicesForHaConnection(haConnectionId);
  const totalDevices = devices.length;

  const monitoringCandidates = devices.filter((d) => getGroupLabel(d) === OTHER_LABEL);
  const monitoringDevices = monitoringCandidates.filter((d) => {
    const unit =
      typeof d.attributes?.unit_of_measurement === 'string'
        ? d.attributes.unit_of_measurement.trim()
        : '';
    return unit.length > 0;
  });

  if (monitoringDevices.length === 0) {
    return {
      haConnectionId,
      totalDevices,
      monitoredCount: monitoringCandidates.length,
      insertedCount: 0,
    };
  }

  const data = monitoringDevices.map((d) => {
    const unit =
      typeof d.attributes?.unit_of_measurement === 'string'
        ? d.attributes.unit_of_measurement.trim()
        : '';
    const numeric = Number(d.state);

    return {
      haConnectionId,
      entityId: d.entityId,
      state: String(d.state ?? ''),
      numericValue: Number.isFinite(numeric) ? numeric : null,
      unit,
      // TODO: consider deduping by date if cron ever runs more than once per day.
    };
  });

  const inserted = await prisma.monitoringReading.createMany({
    data,
  });

  return {
    haConnectionId,
    totalDevices,
    monitoredCount: monitoringCandidates.length,
    insertedCount: inserted.count,
  };
}

export async function captureMonitoringSnapshotForAllConnections() {
  const connections = await prisma.haConnection.findMany({
    select: { id: true },
  });

  let totalDevices = 0;
  let monitoredCount = 0;
  let insertedCount = 0;

  for (const { id } of connections) {
    const summary = await captureMonitoringSnapshotForConnection(id);
    totalDevices += summary.totalDevices;
    monitoredCount += summary.monitoredCount;
    insertedCount += summary.insertedCount;
  }

  return {
    connections: connections.length,
    totalDevices,
    monitoredCount,
    insertedCount,
  };
}
