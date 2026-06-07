import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { prisma } from '@/lib/prisma';
import { buildMonitoringDisplayContext, UNASSIGNED_AREA } from '@/lib/adminMonitoringDisplay';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 90;
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 4000;
const UNASSIGNED = 'Unassigned';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const startOfDayUtc = (date: Date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  return d;
};
const endOfDayUtc = (date: Date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return d;
};
const parseDateOnly = (value: string | null): Date | null => {
  if (!value) return null;
  const parts = value.split('-').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
};

function parseMulti(searchParams: URLSearchParams, key: string): string[] {
  const direct = searchParams.getAll(key);
  const bracketed = searchParams.getAll(`${key}[]`);
  const combined = [...direct, ...bracketed]
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(combined));
}

function parseCsvMulti(searchParams: URLSearchParams, key: string): string[] {
  const raw = parseMulti(searchParams, key);
  const parts = raw.flatMap((value) => value.split(','));
  const cleaned = parts.map((v) => (v ?? '').trim()).filter((v) => v.length > 0);
  return Array.from(new Set(cleaned));
}

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
  const q = (searchParams.get('q') || '').trim();
  const limitRaw = Number.parseInt(searchParams.get('limit') || '', 10);
  const limit = clamp(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1, MAX_LIMIT);
  const rawDays = searchParams.get('days');
  const isAllTime = rawDays === 'all';
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  const daysParsed = Number.parseInt(rawDays || '', 10);
  const days = clamp(Number.isFinite(daysParsed) ? daysParsed : DEFAULT_DAYS, 1, MAX_DAYS);

  const areasFilter = parseMulti(searchParams, 'areas');
  const hasAreaFilter = areasFilter.length > 0;

  const includeLabels = parseCsvMulti(searchParams, 'includeLabels');
  const excludeLabels = parseCsvMulti(searchParams, 'excludeLabels');
  const normalizedInclude = new Set(includeLabels.map((l) => l.toLowerCase()));
  const normalizedExclude = new Set(excludeLabels.map((l) => l.toLowerCase()));
  const labelMode = normalizedInclude.size > 0 ? 'include' : normalizedExclude.size > 0 ? 'exclude' : 'none';

  const whereBase = {
    haConnectionId,
    ...(q ? { entityId: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  let from = startOfDayUtc(new Date(Date.now() - (days - 1) * MS_PER_DAY));
  let to = endOfDayUtc(new Date());

  if (rawFrom || rawTo) {
    const parsedFrom = parseDateOnly(rawFrom);
    const parsedTo = parseDateOnly(rawTo);
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
    const oldest = await prisma.monitoringReading.findFirst({
      where: { haConnectionId },
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true },
    });
    const nowEnd = endOfDayUtc(new Date());
    from = oldest ? startOfDayUtc(oldest.capturedAt) : nowEnd;
    to = nowEnd;
  }

  const deviceWhere: Record<string, unknown> = { haConnectionId };
  if (hasAreaFilter) {
    const allowedAreas = areasFilter.filter((a) => a !== UNASSIGNED);
    const ors = [];
    if (allowedAreas.length > 0) {
      ors.push({ area: { in: allowedAreas } });
    }
    if (areasFilter.includes(UNASSIGNED)) {
      ors.push({ area: null }, { area: '' });
    }
    if (ors.length === 0) {
      return NextResponse.json({ ok: true, energyEntities: [], batteryEntities: [] });
    }
    deviceWhere.OR = ors;
  }

  const devices = await prisma.device.findMany({
    where: deviceWhere,
    select: { entityId: true, name: true, label: true, area: true },
  });

  const allowedEntityIds = new Set(devices.map((d) => d.entityId));
  if (hasAreaFilter && allowedEntityIds.size === 0) {
    return NextResponse.json({ ok: true, energyEntities: [], batteryEntities: [] });
  }

  const energyEntities = await prisma.monitoringReading.findMany({
    where: {
      ...whereBase,
      unit: 'kWh',
      numericValue: { gt: 0 },
      capturedAt: { gte: from, lte: to },
      ...(hasAreaFilter ? { entityId: { in: Array.from(allowedEntityIds) } } : {}),
    },
    distinct: ['entityId'],
    orderBy: [{ entityId: 'asc' }],
    take: limit,
    select: { entityId: true, capturedAt: true },
  });

  const batteryEntities = await prisma.monitoringReading.findMany({
    where: {
      ...whereBase,
      unit: '%',
      entityId: { contains: 'battery', mode: 'insensitive' },
      numericValue: { not: null },
      capturedAt: { gte: from, lte: to },
      ...(hasAreaFilter ? { entityId: { in: Array.from(allowedEntityIds) } } : {}),
    },
    distinct: ['entityId'],
    orderBy: [{ entityId: 'asc' }],
    take: limit,
    select: { entityId: true, capturedAt: true },
  });

  const displayCtx = await buildMonitoringDisplayContext({
    haConnectionId,
    entityIds: Array.from(new Set([...energyEntities, ...batteryEntities].map((row) => row.entityId))),
  });

  const mapRow = (row: { entityId: string; capturedAt: Date }) => {
    return {
      entityId: row.entityId,
      name: displayCtx.displayName(row.entityId),
      area: displayCtx.displayArea(row.entityId),
      sourceArea: displayCtx.sourceArea(row.entityId) || UNASSIGNED_AREA,
      label: displayCtx.displayLabel(row.entityId),
      sourceLabel: displayCtx.sourceLabel(row.entityId),
      lastCapturedAt: row.capturedAt.toISOString(),
    };
  };

  const labelFilter = <T extends { label: string | null; sourceLabel?: string | null }>(rows: T[]) => {
    const visible = rows.filter((row) => displayCtx.isVisibleLabel(row.label));
    if (labelMode === 'none') return visible;
    if (labelMode === 'include') {
      return visible.filter((row) => {
        const candidates = [row.label, row.sourceLabel].filter((value): value is string => Boolean(value));
        return candidates.some((value) => normalizedInclude.has(value.toLowerCase()));
      });
    }
    return visible.filter((row) => {
      const candidates = [row.label, row.sourceLabel].filter((value): value is string => Boolean(value));
      return !candidates.some((value) => normalizedExclude.has(value.toLowerCase()));
    });
  };

  return NextResponse.json({
    ok: true,
    energyEntities: labelFilter(energyEntities.map(mapRow)),
    batteryEntities: labelFilter(batteryEntities.map(mapRow)),
  });
}
