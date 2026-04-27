import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { HistoryBucket, parseBucket, parseDays } from '@/lib/monitoringHistory';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 90;
const BATTERY_LOW_THRESHOLD = 25;
const UNASSIGNED = 'Unassigned';
const MAX_FILTER_ENTITIES = 2000;

const inferLabel = (entityId: string, existing?: string | null) => {
  if (existing && existing.trim()) return existing.trim();
  const id = entityId.toLowerCase();
  if (id.includes('blind')) return 'Blind';
  if (id.includes('motion')) return 'Motion Sensor';
  if (id.includes('spotify')) return 'Spotify';
  if (id.includes('boiler')) return 'Boiler';
  if (id.includes('doorbell')) return 'Doorbell';
  if (id.includes('security')) return 'Home Security';
  if (id.includes('tv')) return 'TV';
  if (id.includes('speaker')) return 'Speaker';
  if (id.includes('light') || id.includes('lamp')) return 'Light';
  return null;
};

type BucketInfo = { key: string; bucketStart: Date; label: string };

const formatDateUtc = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const startOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const endOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

function getIsoWeekInfo(date: Date) {
  const temp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const weekStart = new Date(Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth(), temp.getUTCDate()));
  const weekStartDay = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStartDay - 1));

  return { year: temp.getUTCFullYear(), week, weekStart };
}

function getBucketInfoUtc(bucket: HistoryBucket, capturedAt: Date): BucketInfo {
  if (bucket === 'weekly') {
    const { year, week, weekStart } = getIsoWeekInfo(capturedAt);
    const label = `Week of ${formatDateUtc(new Date(weekStart))}`;
    return { key: `${year}-W${String(week).padStart(2, '0')}`, bucketStart: new Date(weekStart), label };
  }

  if (bucket === 'monthly') {
    const start = new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), 1));
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      bucketStart: start,
      label: `${monthNames[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    };
  }

  const start = startOfDayUtc(capturedAt);
  return { key: formatDateUtc(start), bucketStart: start, label: formatDateUtc(start) };
}

function parseDateOnly(value: string | null, endOfDay = false): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((v) => Number(v));
  const date = endOfDay ? endOfDayUtc(new Date(Date.UTC(y, m - 1, d))) : startOfDayUtc(new Date(Date.UTC(y, m - 1, d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampDays(bucket: HistoryBucket, rawDays: string | null): number {
  const parsed = parseDays(bucket, rawDays);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(Math.max(1, parsed), MAX_DAYS);
}

function ensureRange(bucket: HistoryBucket, searchParams: URLSearchParams) {
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');

  if (rawFrom || rawTo) {
    const from = parseDateOnly(rawFrom, false);
    const to = parseDateOnly(rawTo, true);
    if (!from || !to) {
      return { error: 'Invalid from/to date. Use YYYY-MM-DD.' };
    }
    if (to.getTime() < from.getTime()) {
      return { error: 'from must be on or before to.' };
    }
    const spanDays = Math.floor((endOfDayUtc(to).getTime() - startOfDayUtc(from).getTime()) / MS_PER_DAY) + 1;
    if (spanDays > MAX_DAYS) {
      return { error: `Date range too large. Max ${MAX_DAYS} days.` };
    }
    return { from: startOfDayUtc(from), to: endOfDayUtc(to) };
  }

  const days = clampDays(bucket, searchParams.get('days'));
  const to = endOfDayUtc(new Date());
  const from = startOfDayUtc(new Date(to.getTime() - (days - 1) * MS_PER_DAY));
  return { from, to };
}

const isFiniteNumber = (val: unknown): val is number =>
  typeof val === 'number' && Number.isFinite(val);

type EnergyRow = { entityId: string; numericValue: number | null; capturedAt: Date };

type BucketTotal = { bucketStart: Date; label: string; totalKwhDelta: number };

function addBucketTotal(map: Map<string, BucketTotal>, info: BucketInfo, delta: number) {
  const existing = map.get(info.key);
  if (existing) {
    existing.totalKwhDelta += delta;
  } else {
    map.set(info.key, { bucketStart: info.bucketStart, label: info.label, totalKwhDelta: delta });
  }
}

function addAreaBucketTotal(
  map: Map<string, Map<string, BucketTotal>>,
  area: string,
  info: BucketInfo,
  delta: number
) {
  const bucketMap = map.get(area) ?? new Map<string, BucketTotal>();
  addBucketTotal(bucketMap, info, delta);
  if (!map.has(area)) {
    map.set(area, bucketMap);
  }
}

function parseMulti(searchParams: URLSearchParams, key: string): string[] {
  const direct = searchParams.getAll(key);
  const bracketed = searchParams.getAll(`${key}[]`);
  const combined = [...direct, ...bracketed]
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(combined)).slice(0, MAX_FILTER_ENTITIES);
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  let haConnectionId: number;
  try {
    const { haConnection } = await getUserWithHaConnection(me.id);
    haConnectionId = haConnection.id;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'HA connection not configured' },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const bucket = parseBucket(searchParams.get('bucket'));
  const isAllTime = searchParams.get('days') === 'all';

  const baseRange = ensureRange(bucket, searchParams);
  if ('error' in baseRange) {
    return NextResponse.json({ error: baseRange.error }, { status: 400 });
  }
  const areasFilter = new Set(parseMulti(searchParams, 'areas'));
  const energyEntityFilter = new Set(parseMulti(searchParams, 'energyEntityIds'));
  const batteryEntityFilter = new Set(parseMulti(searchParams, 'batteryEntityIds'));

  let from = baseRange.from;
  let to = baseRange.to;

  if (isAllTime) {
    const oldest = await prisma.monitoringReading.findFirst({
      where: { haConnectionId },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true },
    });
    const nowEnd = endOfDayUtc(new Date());
    from = oldest ? startOfDayUtc(oldest.capturedAt) : nowEnd;
    to = nowEnd;
  }

  const lastSnapshot = await prisma.monitoringReading.findFirst({
    where: { haConnectionId },
    orderBy: { capturedAt: 'desc' },
    select: { capturedAt: true },
  });

  const priceEnv = process.env.ELECTRICITY_PRICE_PER_KWH;
  const pricePerKwh =
    typeof priceEnv === 'string' && priceEnv.trim().length > 0 ? Number(priceEnv) : null;
  const validPrice =
    pricePerKwh !== null && Number.isFinite(pricePerKwh) && pricePerKwh >= 0 ? pricePerKwh : null;

  const deviceAreas = await prisma.device.findMany({
    where: { haConnectionId },
    select: { entityId: true, area: true },
  });
  const areaByEntity = new Map(deviceAreas.map((d) => [d.entityId, (d.area ?? '').trim() || null]));
  const areaAllowed = (entityId: string) => {
    const area = areaByEntity.get(entityId) || UNASSIGNED;
    if (areasFilter.size === 0) return true;
    return areasFilter.has(area);
  };

  const energyRows = await prisma.monitoringReading.findMany({
    where: {
      haConnectionId,
      unit: 'kWh',
      ...(energyEntityFilter.size > 0 ? { entityId: { in: Array.from(energyEntityFilter) } } : {}),
      capturedAt: { gte: from, lte: to },
    },
    orderBy: [{ entityId: 'asc' }, { capturedAt: 'asc' }],
    select: { entityId: true, numericValue: true, capturedAt: true },
  });

  const energyEntityIds = Array.from(new Set(energyRows.map((r) => r.entityId)));
  const baselines =
    energyEntityIds.length === 0
      ? []
      : await prisma.monitoringReading.findMany({
          where: {
            haConnectionId,
            unit: 'kWh',
            entityId: { in: energyEntityIds },
            capturedAt: { lt: from },
          },
          orderBy: [{ entityId: 'asc' }, { capturedAt: 'desc' }],
          select: { entityId: true, numericValue: true },
        });
  const baselineByEntity = new Map<string, { numericValue: number | null }>();
  for (const row of baselines) {
    if (!baselineByEntity.has(row.entityId)) {
      baselineByEntity.set(row.entityId, { numericValue: row.numericValue });
    }
  }

  const bucketTotals = new Map<string, BucketTotal>();
  const areaBucketTotals = new Map<string, Map<string, BucketTotal>>();
  const entityTotals = new Map<string, number>();
  const areaTotals = new Map<string, { total: number; entities: Map<string, number> }>();

  const flushEntity = (entityId: string, readings: EnergyRow[]) => {
    if (readings.length === 0) return;
    if (!areaAllowed(entityId)) return;
    const baseline = baselineByEntity.get(entityId);
    const baselineValue = baseline && isFiniteNumber(baseline.numericValue) ? baseline.numericValue : null;
    let prev = baselineValue;
    const hasBaseline = prev !== null;
    let totalDelta = 0;
    const area = areaByEntity.get(entityId) || UNASSIGNED;

    for (const reading of readings) {
      const numeric = isFiniteNumber(reading.numericValue) ? reading.numericValue : null;
      if (numeric === null) continue;

      if (prev === null) {
        prev = numeric;
        if (!hasBaseline) continue;
      }

      let delta = numeric - (prev ?? 0);
      if (!Number.isFinite(delta) || delta < 0) delta = 0;
      prev = numeric;
      if (delta === 0) continue;

      totalDelta += delta;
      const info = getBucketInfoUtc(bucket, reading.capturedAt);
      addBucketTotal(bucketTotals, info, delta);
      if (area !== UNASSIGNED) {
        addAreaBucketTotal(areaBucketTotals, area, info, delta);
      }
    }

    if (totalDelta === 0) return;

    entityTotals.set(entityId, (entityTotals.get(entityId) ?? 0) + totalDelta);
    const existingArea = areaTotals.get(area) ?? { total: 0, entities: new Map<string, number>() };
    existingArea.total += totalDelta;
    existingArea.entities.set(entityId, (existingArea.entities.get(entityId) ?? 0) + totalDelta);
    areaTotals.set(area, existingArea);
  };

  let currentEntity: string | null = null;
  let buffer: EnergyRow[] = [];
  for (const row of energyRows) {
    if (currentEntity === null) {
      currentEntity = row.entityId;
      buffer.push(row);
      continue;
    }
    if (row.entityId !== currentEntity) {
      flushEntity(currentEntity, buffer);
      currentEntity = row.entityId;
      buffer = [row];
    } else {
      buffer.push(row);
    }
  }
  if (currentEntity) {
    flushEntity(currentEntity, buffer);
  }

  const batteryRows = await prisma.monitoringReading.findMany({
    where: {
      haConnectionId,
      unit: '%',
      entityId: { contains: 'battery', mode: 'insensitive' },
      ...(batteryEntityFilter.size > 0 ? { entityId: { in: Array.from(batteryEntityFilter) } } : {}),
      capturedAt: { gte: from, lte: to },
    },
    orderBy: [{ entityId: 'asc' }, { capturedAt: 'desc' }],
    select: { entityId: true, numericValue: true, capturedAt: true },
  });

  const batteryLatestByDay: Record<
    string,
    { entityId: string; bucketStart: Date; label: string; value: number; capturedAt: Date }
  > = {};
  for (const row of batteryRows) {
    if (!areaAllowed(row.entityId)) continue;
    const numeric = isFiniteNumber(row.numericValue) ? row.numericValue : null;
    if (numeric === null) continue;
    const info = getBucketInfoUtc('daily', row.capturedAt);
    const key = `${row.entityId}:${info.key}`;
    const existing = batteryLatestByDay[key];
    if (!existing || row.capturedAt.getTime() > existing.capturedAt.getTime()) {
      batteryLatestByDay[key] = {
        entityId: row.entityId,
        bucketStart: info.bucketStart,
        label: info.label,
        value: numeric,
        capturedAt: row.capturedAt,
      };
    }
  }

  const batteryBuckets: Record<string, { sum: number; count: number; bucketStart: Date; label: string }> = {};
  for (const entry of Object.values(batteryLatestByDay)) {
    const info = getBucketInfoUtc(bucket, entry.bucketStart);
    const existing = batteryBuckets[info.key];
    if (!existing) {
      batteryBuckets[info.key] = { sum: entry.value, count: 1, bucketStart: info.bucketStart, label: info.label };
    } else {
      existing.sum += entry.value;
      existing.count += 1;
    }
  }

  const seriesBatteryAvgPercent = Object.values(batteryBuckets)
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((b) => ({
      bucketStart: b.bucketStart.toISOString(),
      label: b.label,
      avgPercent: b.sum / b.count,
      count: b.count,
    }));

  const batteryByEntity = new Map<
    string,
    Map<string, { sum: number; count: number; bucketStart: Date; label: string }>
  >();
  for (const entry of Object.values(batteryLatestByDay)) {
    const area = areaByEntity.get(entry.entityId) || UNASSIGNED;
    if (area === UNASSIGNED) continue;
    const info = getBucketInfoUtc(bucket, entry.bucketStart);
    const entityMap = batteryByEntity.get(entry.entityId) ?? new Map();
    const existing = entityMap.get(info.key);
    if (!existing) {
      entityMap.set(info.key, {
        sum: entry.value,
        count: 1,
        bucketStart: info.bucketStart,
        label: info.label,
      });
    } else {
      existing.sum += entry.value;
      existing.count += 1;
    }
    if (!batteryByEntity.has(entry.entityId)) {
      batteryByEntity.set(entry.entityId, entityMap);
    }
  }

  const seriesTotalKwh = Array.from(bucketTotals.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((entry) => ({
      bucketStart: entry.bucketStart.toISOString(),
      label: entry.label,
      totalKwhDelta: entry.totalKwhDelta,
    }));

  const seriesKwhByArea = Array.from(areaBucketTotals.entries())
    .filter(([area]) => area !== UNASSIGNED)
    .map(([area, buckets]) => ({
      area,
      points: Array.from(buckets.values())
        .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
        .map((entry) => ({
          bucketStart: entry.bucketStart.toISOString(),
          label: entry.label,
          totalKwhDelta: entry.totalKwhDelta,
        })),
    }))
    .sort((a, b) => a.area.localeCompare(b.area));

  const seriesTotalCost =
    validPrice === null
      ? []
      : seriesTotalKwh.map((entry) => ({
          bucketStart: entry.bucketStart,
          label: entry.label,
          estimatedCost: entry.totalKwhDelta * validPrice,
        }));

  const prettyId = (id: string) => id.replace(/^sensor\./i, '').replace(/_/g, ' ');
  const metaEntityIds = new Set<string>([
    ...entityTotals.keys(),
    ...batteryRows.map((row) => row.entityId),
  ]);
  const deviceMeta = await prisma.device.findMany({
    where: { haConnectionId, entityId: { in: Array.from(metaEntityIds) } },
    select: { entityId: true, name: true, label: true, area: true },
  });
  const deviceByEntity = new Map(deviceMeta.map((d) => [d.entityId, d]));
  const displayName = (entityId: string) => {
    const device = deviceByEntity.get(entityId);
    const primary = device?.name?.trim();
    const fallbackLabel = device?.label?.trim();
    const inferred = inferLabel(entityId, device?.label);
    const base = primary || fallbackLabel || inferred || entityId;
    return prettyId(base).trim() || entityId;
  };

  const topEntities = Array.from(entityTotals.entries())
    .map(([entityId, totalKwhDelta]) => ({
      entityId,
      name: displayName(entityId),
      label: inferLabel(entityId, deviceByEntity.get(entityId)?.label),
      totalKwhDelta,
      estimatedCost: validPrice === null ? undefined : totalKwhDelta * validPrice,
      area: areaByEntity.get(entityId) || UNASSIGNED,
    }))
    .sort((a, b) => b.totalKwhDelta - a.totalKwhDelta)
    .slice(0, 20);

  const areaEntries = Array.from(areaTotals.entries()).map(([area, info]) => {
    const topAreaEntities = Array.from(info.entities.entries())
      .map(([entityId, totalKwhDelta]) => ({
        entityId,
        name: displayName(entityId),
        label: inferLabel(entityId, deviceByEntity.get(entityId)?.label),
        totalKwhDelta,
        estimatedCost: validPrice === null ? undefined : totalKwhDelta * validPrice,
      }))
      .sort((a, b) => b.totalKwhDelta - a.totalKwhDelta)
      .slice(0, 10);

    return {
      area,
      totalKwhDelta: info.total,
      estimatedCost: validPrice === null ? undefined : info.total * validPrice,
      topEntities: topAreaEntities,
    };
  });

  const batteryLow: Array<{ entityId: string; name: string; label: string | null; latestBatteryPercent: number; capturedAt: string }> = [];
  const seenBattery = new Set<string>();
  for (const row of batteryRows) {
    if (seenBattery.has(row.entityId)) continue;
    seenBattery.add(row.entityId);
    const numeric = isFiniteNumber(row.numericValue) ? row.numericValue : null;
    if (numeric !== null && numeric < BATTERY_LOW_THRESHOLD) {
      batteryLow.push({
        entityId: row.entityId,
        name: displayName(row.entityId),
        label: inferLabel(row.entityId, deviceByEntity.get(row.entityId)?.label),
        latestBatteryPercent: numeric,
        capturedAt: row.capturedAt.toISOString(),
      });
    }
  }

  const seriesBatteryByEntity = Array.from(batteryByEntity.entries())
    .map(([entityId, buckets]) => ({
      entityId,
      name: displayName(entityId),
      points: Array.from(buckets.values())
        .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
        .map((entry) => ({
          bucketStart: entry.bucketStart.toISOString(),
          label: entry.label,
          avgPercent: entry.sum / entry.count,
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const unassigned = areaEntries.find((a) => a.area === UNASSIGNED);
  const rankedAreas = areaEntries
    .filter((a) => a.area !== UNASSIGNED)
    .sort((a, b) => b.totalKwhDelta - a.totalKwhDelta);
  const cappedAreas = rankedAreas.slice(0, 30);
  if (unassigned && !cappedAreas.some((a) => a.area === UNASSIGNED)) {
    cappedAreas.push(unassigned);
  }

  const entitiesWithReadings = new Set<string>();
  energyRows.forEach((r) => entitiesWithReadings.add(r.entityId));
  batteryRows.forEach((r) => entitiesWithReadings.add(r.entityId));

  const monitoredEntities = await prisma.monitoringReading.findMany({
    where: {
      haConnectionId,
      OR: [
        { unit: 'kWh' },
        { unit: '%', entityId: { contains: 'battery', mode: 'insensitive' } },
      ],
    },
    distinct: ['entityId'],
    select: { entityId: true },
  });

  return NextResponse.json({
    ok: true,
    bucket,
    range: { from: from.toISOString(), to: to.toISOString() },
    lastSnapshotAt: lastSnapshot?.capturedAt?.toISOString() ?? null,
    pricePerKwh: validPrice,
    coverage: {
      entitiesWithReadings: entitiesWithReadings.size,
      entitiesMonitored: monitoredEntities.length,
    },
    seriesTotalKwh,
    seriesKwhByArea,
    seriesTotalCost,
    topEntities,
    byArea: cappedAreas,
    seriesBatteryAvgPercent,
    seriesBatteryByEntity,
    batteryLow,
  });
}
