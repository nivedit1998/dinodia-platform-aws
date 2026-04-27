import { prisma } from '@/lib/prisma';

export async function cleanupMonitoringReadings() {
  await prisma.monitoringReading.deleteMany({
    where: {
      OR: [
        { unit: null },
        { unit: { notIn: ['kWh', '%'] } },
        { unit: '%', entityId: { not: { contains: 'battery' } } },
        { unit: 'kWh', OR: [{ numericValue: null }, { numericValue: { lte: 0 } }] },
      ],
    },
  });

  await prisma.monitoringReading.updateMany({
    where: {
      unit: '%',
      entityId: { contains: 'battery' },
      numericValue: null,
    },
    data: { numericValue: 0 },
  });
}
