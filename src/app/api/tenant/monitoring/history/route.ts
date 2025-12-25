import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';

type Bucket = 'daily' | 'weekly' | 'monthly';

type BucketInfo = {
  key: string;
  bucketStart: Date;
  label: string;
};

type AggregatedBucket = {
  sum: number;
  count: number;
  bucketStart: Date;
  label: string;
};

const DEFAULT_DAYS: Record<Bucket, number> = {
  daily: 30,
  weekly: 7 * 12,
  monthly: 365,
};

function parseBucket(value: string | null): Bucket {
  if (value === 'weekly' || value === 'monthly') return value;
  return 'daily';
}

function parseDays(bucket: Bucket, rawDays: string | null): number {
  if (rawDays) {
    const parsed = parseInt(rawDays, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_DAYS[bucket];
}

function startOfDayLocal(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateLabel(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatMonthLabel(date: Date) {
  const y = date.getFullYear();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[date.getMonth()]} ${y}`;
}

function getIsoWeekInfo(date: Date) {
  const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const weekStart = new Date(Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth(), temp.getUTCDate()));
  const weekStartDay = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStartDay - 1));

  return { year: temp.getUTCFullYear(), week, weekStart };
}

function getBucketInfo(bucket: Bucket, capturedAt: Date): BucketInfo {
  if (bucket === 'weekly') {
    const { year, week, weekStart } = getIsoWeekInfo(capturedAt);
    const label = `Week of ${formatDateLabel(new Date(weekStart))}`;
    return {
      key: `${year}-W${String(week).padStart(2, '0')}`,
      bucketStart: new Date(weekStart),
      label,
    };
  }

  if (bucket === 'monthly') {
    const start = new Date(capturedAt.getFullYear(), capturedAt.getMonth(), 1);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      bucketStart: start,
      label: formatMonthLabel(start),
    };
  }

  const start = startOfDayLocal(capturedAt);
  return {
    key: formatDateLabel(start),
    bucketStart: start,
    label: formatDateLabel(start),
  };
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || (me.role !== Role.ADMIN && me.role !== Role.TENANT)) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get('entityId');
  const bucket = parseBucket(searchParams.get('bucket'));
  const days = parseDays(bucket, searchParams.get('days'));

  if (!entityId || typeof entityId !== 'string' || entityId.trim().length === 0) {
    return NextResponse.json(
      { error: 'Please select a valid device to view history.' },
      { status: 400 }
    );
  }

  let user;
  let haConnection;
  try {
    ({ user, haConnection } = await getUserWithHaConnection(me.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'HA connection not configured' },
      { status: 400 }
    );
  }

  const haConnectionId = haConnection.id;

  if (user.role === Role.TENANT) {
    let devices;
    try {
      devices = await getDevicesForHaConnection(haConnectionId);
    } catch (err) {
      console.error('Failed to fetch devices for tenant history', err);
      return NextResponse.json(
        { error: 'Dinodia Hub did not respond when loading devices.' },
        { status: 502 }
      );
    }

    const allowedDevices = devices.filter(
      (d) =>
        d.areaName !== null &&
        user.accessRules.some((r) => r.area === d.areaName)
    );
    const target = allowedDevices.find((d) => d.entityId === entityId);
    if (!target) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'You don’t have access to this device. Ask the homeowner to update your access in Dinodia.',
        },
        { status: 403 }
      );
    }
  }

  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let readings;
  try {
    readings = await prisma.monitoringReading.findMany({
      where: {
        haConnectionId,
        entityId,
        capturedAt: { gte: fromDate },
      },
      orderBy: { capturedAt: 'asc' },
      select: {
        numericValue: true,
        unit: true,
        capturedAt: true,
      },
    });
  } catch (err) {
    console.error('Failed to fetch monitoring history', err);
    return NextResponse.json(
      { error: 'Failed to load history' },
      { status: 500 }
    );
  }

  let unit: string | null = null;
  const buckets: Record<string, AggregatedBucket> = {};

  for (const reading of readings) {
    if (unit === null && typeof reading.unit === 'string' && reading.unit.trim().length > 0) {
      unit = reading.unit.trim();
    }

    const numeric = typeof reading.numericValue === 'number' ? reading.numericValue : NaN;
    if (!Number.isFinite(numeric)) continue;

    const capturedAt = new Date(reading.capturedAt);
    const info = getBucketInfo(bucket, capturedAt);
    const existing = buckets[info.key];
    if (!existing) {
      buckets[info.key] = {
        sum: numeric,
        count: 1,
        bucketStart: info.bucketStart,
        label: info.label,
      };
    } else {
      existing.sum += numeric;
      existing.count += 1;
    }
  }

  const shouldUseSum = typeof unit === 'string' && unit.toLowerCase().includes('wh');

  const points = Object.values(buckets)
    .filter((b) => b.count > 0)
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((b) => ({
      bucketStart: b.bucketStart.toISOString(),
      label: b.label,
      value: shouldUseSum ? b.sum : b.sum / b.count,
      count: b.count,
    }));

  return NextResponse.json({
    ok: true,
    entityId,
    bucket,
    unit,
    points,
  });
}
