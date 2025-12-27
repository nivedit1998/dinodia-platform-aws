import { DeviceStatus } from '@prisma/client';
import { prisma } from './prisma';

export class DeviceBlockedError extends Error {
  status: DeviceStatus;

  constructor(status: DeviceStatus, message?: string) {
    super(message ?? `Device is ${status.toLowerCase()}`);
    this.status = status;
  }
}

export async function getDeviceRecord(deviceId: string | null | undefined) {
  if (!deviceId) return null;
  return prisma.deviceRegistry.findUnique({ where: { deviceId } });
}

export async function ensureActiveDevice(deviceId: string | null | undefined) {
  if (!deviceId) {
    throw new DeviceBlockedError(DeviceStatus.BLOCKED, 'Missing device id');
  }
  const record = await getOrCreateDevice(deviceId);
  if (record.status !== DeviceStatus.ACTIVE) {
    throw new DeviceBlockedError(record.status, `Device is ${record.status.toLowerCase()}`);
  }
  return record;
}

export async function getOrCreateDevice(deviceId: string) {
  return prisma.deviceRegistry.upsert({
    where: { deviceId },
    update: { lastSeenAt: new Date() },
    create: {
      deviceId,
      status: DeviceStatus.ACTIVE,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

export async function markDeviceStatus(
  deviceId: string,
  status: DeviceStatus,
  label?: string | null
) {
  await prisma.deviceRegistry.upsert({
    where: { deviceId },
    update: {
      status,
      label: label ?? undefined,
      lastSeenAt: new Date(),
    },
    create: {
      deviceId,
      status,
      label: label ?? undefined,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}
