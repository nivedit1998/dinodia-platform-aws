import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getGroupLabel } from '@/lib/deviceLabels';

type Metric = 'minutesOn' | 'kwh' | 'costGbp';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MAX_DAYS = 365;

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

function normalizeHeatingLabel(value: string | null) {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'boiler') return 'Boiler';
  if (normalized === 'radiator') return 'Radiator';
  return null;
}

function normalizeMetric(value: string | null): Metric {
  const normalized = (value ?? '').trim();
  if (normalized === 'kwh') return 'kwh';
  if (normalized === 'costGbp') return 'costGbp';
  return 'minutesOn';
}

const prettyEntityId = (id: string) => id.replace(/^[^.]+\./i, '').replace(/_/g, ' ');

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
  const requestedLabel = normalizeHeatingLabel(searchParams.get('label'));
  const metric = normalizeMetric(searchParams.get('metric'));
  const rawDays = searchParams.get('days');
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  const isAllTime = rawDays === 'all';
  const daysParsed = Number.parseInt(rawDays || '', 10);
  const days = Number.isFinite(daysParsed) && daysParsed > 0 ? Math.min(daysParsed, MAX_DAYS) : 30;

  const selectedEntityIds = parseMulti(searchParams, 'entityIds');
  const boilerEntityIdsOverride = parseMulti(searchParams, 'boilerEntityIds');
  const groupBy = (searchParams.get('groupBy') ?? '').trim().toLowerCase() === 'total' ? 'total' : 'entity';

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
      where: { haConnectionId, entityId: { in: selectedEntityIds } },
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
      select: { entityId: true, name: true, area: true, label: true, boilerPowerKw: true, heatingPricePerKwh: true },
    }),
  ]);

  const haMap = new Map(
    haDevices.map((d) => [d.entityId, { name: d.name ?? '', area: d.area ?? d.areaName ?? null, label: getGroupLabel(d) }])
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

  const resolveLabel = (entityId: string) => {
    const ha = haMap.get(entityId);
    const override = overrideMap.get(entityId);
    const overrideLabel = (override?.label ?? '').trim();
    if (overrideLabel) return overrideLabel;
    return ha?.label ?? null;
  };

  let inferredEntityIds: string[] = [];
  if (selectedEntityIds.length === 0) {
    const inferred = await prisma.boilerTemperatureReading.findMany({
      where: { haConnectionId, capturedAt: { gte: from, lte: to } },
      distinct: ['entityId'],
      orderBy: [{ entityId: 'asc' }],
      select: { entityId: true },
    });
    inferredEntityIds = inferred.map((row) => row.entityId);
  }

  const baseEntityIds = selectedEntityIds.length > 0 ? selectedEntityIds : inferredEntityIds;
  const allowedEntityIds = requestedLabel
    ? baseEntityIds.filter((id) => {
        const label = resolveLabel(id);
        return label ? label.toLowerCase() === requestedLabel.toLowerCase() : true; // degrade gracefully when HA labels unavailable
      })
    : baseEntityIds;

  if (allowedEntityIds.length === 0) {
    return NextResponse.json({ ok: true, unit: metric === 'minutesOn' ? 'min' : metric === 'kwh' ? 'kWh' : 'GBP', metric, seriesByEntity: [], meta: { label: requestedLabel } });
  }

  const parseEnvNumber = (raw?: string | null) => {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  };

  const defaultBoilerPowerKw = parseEnvNumber(process.env.BOILER_POWER_KW);
  const defaultPricePerKwh = parseEnvNumber(process.env.HEATING_PRICE_PER_KWH ?? process.env.ELECTRICITY_PRICE_PER_KWH);

  const resolveBoilerPowerKw = (entityId: string) => {
    const override = overrideMap.get(entityId);
    const value = typeof override?.boilerPowerKw === 'number' && Number.isFinite(override.boilerPowerKw) ? override.boilerPowerKw : null;
    return value != null && value > 0 ? value : defaultBoilerPowerKw;
  };

  const resolveHeatingPricePerKwh = (entityId: string) => {
    const override = overrideMap.get(entityId);
    const value = typeof override?.heatingPricePerKwh === 'number' && Number.isFinite(override.heatingPricePerKwh) ? override.heatingPricePerKwh : null;
    return value != null && value >= 0 ? value : defaultPricePerKwh;
  };

  const readings = await prisma.boilerTemperatureReading.findMany({
    where: {
      haConnectionId,
      entityId: { in: allowedEntityIds },
      capturedAt: { gte: from, lte: to },
    },
    orderBy: { capturedAt: 'asc' },
    select: {
      entityId: true,
      capturedAt: true,
      onForSeconds: true,
      offForSeconds: true,
      unknownForSeconds: true,
      kwhOnEstimated: true,
    },
  });

  const pointsByEntity = new Map<
    string,
    Array<{ ts: string; label?: string; onMinutes: number | null; offMinutes: number | null; unknownMinutes: number | null; value?: number | null }>
  >();

  if (metric === 'minutesOn') {
    for (const row of readings) {
      const list = pointsByEntity.get(row.entityId) ?? [];
      const onMinutes = typeof row.onForSeconds === 'number' ? row.onForSeconds / 60 : null;
      list.push({
        ts: row.capturedAt.toISOString(),
        label: row.capturedAt.toISOString(),
        onMinutes,
        offMinutes: typeof row.offForSeconds === 'number' ? row.offForSeconds / 60 : null,
        unknownMinutes: typeof row.unknownForSeconds === 'number' ? row.unknownForSeconds / 60 : null,
        value: typeof onMinutes === 'number' && Number.isFinite(onMinutes) ? onMinutes : 0,
      });
      pointsByEntity.set(row.entityId, list);
    }
  } else {
    const isBoiler = (requestedLabel ?? '').toLowerCase() === 'boiler';
    const isRadiator = (requestedLabel ?? '').toLowerCase() === 'radiator';

    const boilerEntityIds = (
      boilerEntityIdsOverride.length > 0
        ? boilerEntityIdsOverride
        : haDevices.filter((d) => (getGroupLabel(d) || '').toLowerCase() === 'boiler').map((d) => d.entityId)
    ).filter((id) => (resolveLabel(id) || '').toLowerCase() === 'boiler');

    const boilerReadings = boilerEntityIds.length
      ? await prisma.boilerTemperatureReading.findMany({
          where: { haConnectionId, entityId: { in: boilerEntityIds }, capturedAt: { gte: from, lte: to } },
          orderBy: { capturedAt: 'asc' },
          select: { entityId: true, capturedAt: true, onForSeconds: true, kwhOnEstimated: true },
        })
      : [];

    const boilerTotalsByTs = new Map<string, { kwh: number; cost: number }>();
    const boilerByEntityByTs = new Map<string, Map<string, { kwh: number; cost: number }>>();
    for (const row of boilerReadings) {
      const ts = row.capturedAt.toISOString();
      const seconds = typeof row.onForSeconds === 'number' && Number.isFinite(row.onForSeconds) ? Math.max(0, row.onForSeconds) : 0;
      const power = resolveBoilerPowerKw(row.entityId);
      const kwh =
        typeof row.kwhOnEstimated === 'number' && Number.isFinite(row.kwhOnEstimated) && row.kwhOnEstimated >= 0
          ? row.kwhOnEstimated
          : power != null
          ? (seconds / 3600) * power
          : 0;
      const price = resolveHeatingPricePerKwh(row.entityId);
      const cost = price != null ? kwh * price : 0;
      const existing = boilerTotalsByTs.get(ts);
      if (existing) {
        existing.kwh += kwh;
        existing.cost += cost;
      } else {
        boilerTotalsByTs.set(ts, { kwh, cost });
      }
      if (!boilerByEntityByTs.has(row.entityId)) boilerByEntityByTs.set(row.entityId, new Map());
      boilerByEntityByTs.get(row.entityId)!.set(ts, { kwh, cost });
    }

    const radiatorMinutesTotalByTs = new Map<string, number>();
    if (isRadiator) {
      for (const row of readings) {
        const ts = row.capturedAt.toISOString();
        const minutes = typeof row.onForSeconds === 'number' && Number.isFinite(row.onForSeconds) ? Math.max(0, row.onForSeconds) / 60 : 0;
        radiatorMinutesTotalByTs.set(ts, (radiatorMinutesTotalByTs.get(ts) ?? 0) + minutes);
      }
    }

    for (const row of readings) {
      const ts = row.capturedAt.toISOString();
      const onMinutes = typeof row.onForSeconds === 'number' && Number.isFinite(row.onForSeconds) ? Math.max(0, row.onForSeconds) / 60 : 0;
      let value = 0;
      if (isBoiler) {
        const perEntity = boilerByEntityByTs.get(row.entityId)?.get(ts);
        value = metric === 'kwh' ? perEntity?.kwh ?? 0 : perEntity?.cost ?? 0;
      } else if (isRadiator) {
        const boilerTotals = boilerTotalsByTs.get(ts);
        const totalMinutes = radiatorMinutesTotalByTs.get(ts) ?? 0;
        const ratio = totalMinutes > 0 ? onMinutes / totalMinutes : 0;
        const allocated = metric === 'kwh' ? (boilerTotals?.kwh ?? 0) * ratio : (boilerTotals?.cost ?? 0) * ratio;
        value = allocated;
      }

      const list = pointsByEntity.get(row.entityId) ?? [];
      list.push({
        ts,
        label: ts,
        onMinutes: null,
        offMinutes: null,
        unknownMinutes: null,
        value: Number.isFinite(value) ? value : 0,
      });
      pointsByEntity.set(row.entityId, list);
    }
  }

  const seriesByEntity = allowedEntityIds
    .map((entityId) => ({
      entityId,
      name: resolveName(entityId),
      area: resolveArea(entityId),
      label: resolveLabel(entityId),
      points: pointsByEntity.get(entityId) ?? [],
    }))
    .filter((s) => s.points.length > 0);

  if (groupBy === 'total') {
    const combined = new Map<string, { ts: string; onMinutes: number | null; offMinutes: number | null; unknownMinutes: number | null; value: number }>();
    for (const s of seriesByEntity) {
      for (const p of s.points) {
        const existing = combined.get(p.ts);
        const value = typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : 0;
        if (existing) {
          existing.value += value;
        } else {
          combined.set(p.ts, { ts: p.ts, onMinutes: null, offMinutes: null, unknownMinutes: null, value });
        }
      }
    }
    return NextResponse.json({
      ok: true,
      unit: metric === 'minutesOn' ? 'min' : metric === 'kwh' ? 'kWh' : 'GBP',
      metric,
      seriesByEntity: [
        {
          entityId: 'total',
          name: 'Total',
          area: null,
          label: requestedLabel,
          points: Array.from(combined.values()).sort((a, b) => a.ts.localeCompare(b.ts)),
        },
      ],
      meta: {
        label: requestedLabel,
        metric,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    unit: metric === 'minutesOn' ? 'min' : metric === 'kwh' ? 'kWh' : 'GBP',
    metric,
    seriesByEntity,
    meta: {
      label: requestedLabel,
      metric,
      from: from.toISOString(),
      to: to.toISOString(),
    },
  });
}
