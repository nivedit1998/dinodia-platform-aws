import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MAX_DAYS = 365;
const UNASSIGNED = 'Unassigned';

const startOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));

const endOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

const parseDateOnly = (value: string | null, endOfDay = false): Date | null => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((v) => Number(v));
  const date = endOfDay ? endOfDayUtc(new Date(Date.UTC(y, m - 1, d))) : startOfDayUtc(new Date(Date.UTC(y, m - 1, d)));
  return Number.isNaN(date.getTime()) ? null : date;
};

function parseMulti(searchParams: URLSearchParams, key: string): string[] {
  const direct = searchParams.getAll(key);
  const bracketed = searchParams.getAll(`${key}[]`);
  const combined = [...direct, ...bracketed]
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(combined));
}

function bucket2hUtc(date: Date) {
  const hour = date.getUTCHours();
  const bucketHour = Math.floor(hour / 2) * 2;
  const bucketStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), bucketHour, 0, 0, 0));
  const label = `${bucketStart.getUTCFullYear()}-${String(bucketStart.getUTCMonth() + 1).padStart(2, '0')}-${String(
    bucketStart.getUTCDate()
  ).padStart(2, '0')} ${String(bucketHour).padStart(2, '0')}:00`;
  return { key: bucketStart.toISOString(), bucketStart, label };
}

const prettyEntityId = (id: string) => id.replace(/^[^.]+\./i, '').replace(/_/g, ' ');

type ValueBucket = {
  bucketStart: Date;
  label: string;
  sum: number;
  count: number;
};

type TemperatureBucket = {
  bucketStart: Date;
  label: string;
  currentSum: number;
  currentCount: number;
  targetSum: number;
  targetCount: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  let haConnectionId: number;
  try {
    const { haConnection } = await getUserWithHaConnection(me.id);
    haConnectionId = haConnection.id;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection is missing for this home.' },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawDays = searchParams.get('days');
  const isAllTime = rawDays === 'all';
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  const daysParsed = Number.parseInt(rawDays || '', 10);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 ? Math.min(daysParsed, MAX_DAYS) : 90;
  const groupBy = searchParams.get('groupBy');
  const groupByArea = groupBy === 'area';

  const selectedEntityIds = parseMulti(searchParams, 'entityIds');
  const areasFilter = new Set(parseMulti(searchParams, 'areas'));

  if (!groupByArea && selectedEntityIds.length === 0) {
    return NextResponse.json({
      ok: true,
      unit: '°C',
      points: [],
      seriesByArea: [],
      seriesByEntity: [],
      seriesTemperatureByEntity: [],
      seriesHeatingStateByEntity: [],
    });
  }

  let from = startOfDayUtc(new Date(Date.now() - (days - 1) * MS_PER_DAY));
  let to = endOfDayUtc(new Date());

  if (rawFrom || rawTo) {
    const parsedFrom = parseDateOnly(rawFrom, false);
    const parsedTo = parseDateOnly(rawTo, true);
    if (!parsedFrom || !parsedTo) {
      return NextResponse.json({ error: 'Invalid from/to date. Use YYYY-MM-DD.' }, { status: 400 });
    }
    if (parsedTo.getTime() < parsedFrom.getTime()) {
      return NextResponse.json({ error: 'from must be on or before to.' }, { status: 400 });
    }
    const spanDays = Math.floor((endOfDayUtc(parsedTo).getTime() - startOfDayUtc(parsedFrom).getTime()) / MS_PER_DAY) + 1;
    if (spanDays > MAX_DAYS && !isAllTime) {
      return NextResponse.json({ error: `Date range too large. Max ${MAX_DAYS} days.` }, { status: 400 });
    }
    from = startOfDayUtc(parsedFrom);
    to = endOfDayUtc(parsedTo);
  }

  if (isAllTime) {
    const oldest = await prisma.boilerTemperatureReading.findFirst({
      where: { haConnectionId },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true },
    });
    const nowEnd = endOfDayUtc(new Date());
    from = oldest ? startOfDayUtc(oldest.capturedAt) : nowEnd;
    to = nowEnd;
  }

  const [haDevices, overrides] = await Promise.all([
    getDevicesForHaConnection(haConnectionId, { cacheTtlMs: 2000 }).catch(() => []),
    prisma.device.findMany({
      where: { haConnectionId },
      select: { entityId: true, name: true, area: true },
    }),
  ]);

  const haMap = new Map(
    haDevices.map((d) => [d.entityId, { name: d.name ?? '', area: d.area ?? d.areaName ?? null }])
  );
  const overrideMap = new Map(overrides.map((d) => [d.entityId, d]));

  const resolveArea = (entityId: string) => {
    const ha = haMap.get(entityId);
    const override = overrideMap.get(entityId);
    return (override?.area ?? ha?.area ?? '').trim() || null;
  };
  const resolveName = (entityId: string) => {
    const ha = haMap.get(entityId);
    const override = overrideMap.get(entityId);
    const name = (override?.name ?? ha?.name ?? '').trim();
    return name || prettyEntityId(entityId);
  };
  const hasEntityFilter = selectedEntityIds.length > 0;
  const selectedEntitySet = new Set(selectedEntityIds);
  const hasAreaFilter = areasFilter.size > 0;
  const isAssignedArea = (area: string | null) => {
    const normalized = (area ?? '').trim();
    return normalized.length > 0 && normalized.toLowerCase() !== UNASSIGNED.toLowerCase();
  };
  const matchesArea = (area: string | null) => {
    if (!isAssignedArea(area)) return false;
    if (!hasAreaFilter) return true;
    return areasFilter.has((area ?? '').trim());
  };

  const allKnownEntityIds = Array.from(new Set([...haMap.keys(), ...overrideMap.keys()]));
  let queryEntityIds: string[] | null = hasEntityFilter ? Array.from(selectedEntitySet) : null;
  if (hasAreaFilter) {
    queryEntityIds = (queryEntityIds ?? allKnownEntityIds).filter((id) => matchesArea(resolveArea(id)));
  }
  if (queryEntityIds && queryEntityIds.length === 0) {
    return NextResponse.json({
      ok: true,
      unit: '°C',
      points: [],
      seriesByArea: [],
      seriesByEntity: [],
      seriesTemperatureByEntity: [],
      seriesHeatingStateByEntity: [],
    });
  }

  const readings = await prisma.boilerTemperatureReading.findMany({
    where: {
      haConnectionId,
      ...(queryEntityIds ? { entityId: { in: queryEntityIds } } : {}),
      capturedAt: { gte: from, lte: to },
    },
    orderBy: { capturedAt: 'asc' },
    select: {
      entityId: true,
      numericValue: true,
      currentTemperature: true,
      targetTemperature: true,
      capturedAt: true,
    },
  });

  const areaBuckets = new Map<string, Map<string, ValueBucket>>();
  const entityBuckets = new Map<string, Map<string, ValueBucket>>();
  const entityTemperatureBuckets = new Map<string, Map<string, TemperatureBucket>>();
  const totalBuckets = new Map<string, ValueBucket>();

  for (const reading of readings) {
    const area = resolveArea(reading.entityId);
    if (!matchesArea(area)) continue;
    if (hasEntityFilter && !selectedEntitySet.has(reading.entityId)) continue;

    const currentValue = isFiniteNumber(reading.currentTemperature)
      ? reading.currentTemperature
      : isFiniteNumber(reading.numericValue)
      ? reading.numericValue
      : null;
    if (currentValue == null) continue;

    const targetValue = isFiniteNumber(reading.targetTemperature) ? reading.targetTemperature : null;
    const info = bucket2hUtc(reading.capturedAt);

    const perArea = areaBuckets.get(area!) ?? new Map();
    const areaExisting = perArea.get(info.key);
    if (!areaExisting) {
      perArea.set(info.key, {
        bucketStart: info.bucketStart,
        label: info.label,
        sum: currentValue,
        count: 1,
      });
    } else {
      areaExisting.sum += currentValue;
      areaExisting.count += 1;
    }
    if (!areaBuckets.has(area!)) areaBuckets.set(area!, perArea);

    const perEntity = entityBuckets.get(reading.entityId) ?? new Map();
    const entityExisting = perEntity.get(info.key);
    if (!entityExisting) {
      perEntity.set(info.key, {
        bucketStart: info.bucketStart,
        label: info.label,
        sum: currentValue,
        count: 1,
      });
    } else {
      entityExisting.sum += currentValue;
      entityExisting.count += 1;
    }
    if (!entityBuckets.has(reading.entityId)) entityBuckets.set(reading.entityId, perEntity);

    const perEntityTemp = entityTemperatureBuckets.get(reading.entityId) ?? new Map();
    const tempExisting = perEntityTemp.get(info.key);
    if (!tempExisting) {
      perEntityTemp.set(info.key, {
        bucketStart: info.bucketStart,
        label: info.label,
        currentSum: currentValue,
        currentCount: 1,
        targetSum: targetValue ?? 0,
        targetCount: targetValue == null ? 0 : 1,
      });
    } else {
      tempExisting.currentSum += currentValue;
      tempExisting.currentCount += 1;
      if (targetValue != null) {
        tempExisting.targetSum += targetValue;
        tempExisting.targetCount += 1;
      }
    }
    if (!entityTemperatureBuckets.has(reading.entityId)) entityTemperatureBuckets.set(reading.entityId, perEntityTemp);

    const totalExisting = totalBuckets.get(info.key);
    if (!totalExisting) {
      totalBuckets.set(info.key, {
        bucketStart: info.bucketStart,
        label: info.label,
        sum: currentValue,
        count: 1,
      });
    } else {
      totalExisting.sum += currentValue;
      totalExisting.count += 1;
    }
  }

  const seriesByArea = Array.from(areaBuckets.entries())
    .map(([area, buckets]) => ({
      area,
      points: Array.from(buckets.values())
        .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
        .map((b) => ({
          bucketStart: b.bucketStart.toISOString(),
          label: b.label,
          value: b.count > 0 ? b.sum / b.count : 0,
        })),
    }))
    .sort((a, b) => a.area.localeCompare(b.area));

  const seriesByEntity = Array.from(entityBuckets.entries())
    .map(([entityId, buckets]) => ({
      entityId,
      name: resolveName(entityId),
      area: resolveArea(entityId) || UNASSIGNED,
      points: Array.from(buckets.values())
        .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
        .map((b) => ({
          bucketStart: b.bucketStart.toISOString(),
          label: b.label,
          value: b.count > 0 ? b.sum / b.count : 0,
        })),
    }))
    .filter((series) => isAssignedArea(series.area))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.entityId.localeCompare(b.entityId);
    });

  const seriesTemperatureByEntity = Array.from(entityTemperatureBuckets.entries())
    .map(([entityId, buckets]) => ({
      entityId,
      name: resolveName(entityId),
      area: resolveArea(entityId) || UNASSIGNED,
      points: Array.from(buckets.values())
        .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
        .map((b) => ({
          bucketStart: b.bucketStart.toISOString(),
          label: b.label,
          currentTemperature: b.currentCount > 0 ? b.currentSum / b.currentCount : 0,
          targetTemperature: b.targetCount > 0 ? b.targetSum / b.targetCount : null,
        })),
    }))
    .filter((series) => isAssignedArea(series.area))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.entityId.localeCompare(b.entityId);
    });

  const seriesHeatingStateByEntity = seriesTemperatureByEntity.map((series) => ({
    entityId: series.entityId,
    name: series.name,
    area: series.area,
    points: series.points.map((point) => ({
      bucketStart: point.bucketStart,
      label: point.label,
      state:
        point.targetTemperature == null
          ? null
          : point.targetTemperature > point.currentTemperature
          ? 1
          : 0,
    })),
  }));

  const points = Array.from(totalBuckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((b) => ({
      bucketStart: b.bucketStart.toISOString(),
      label: b.label,
      value: b.count > 0 ? b.sum / b.count : 0,
    }));

  return NextResponse.json({
    ok: true,
    unit: '°C',
    points: groupByArea ? [] : points,
    seriesByArea,
    seriesByEntity,
    seriesTemperatureByEntity,
    seriesHeatingStateByEntity,
  });
}
