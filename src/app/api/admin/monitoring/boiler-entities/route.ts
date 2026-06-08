import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { getGroupLabel } from '@/lib/deviceLabels';
import { buildMonitoringDisplayContext, UNASSIGNED_AREA } from '@/lib/adminMonitoringDisplay';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 4000;
const UNASSIGNED = 'Unassigned';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const startOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));

const endOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

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

function normalizeHeatingLabel(value: string | null) {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'boiler') return 'Boiler';
  if (normalized === 'radiator') return 'Radiator';
  return null;
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
  const requestedLabel = normalizeHeatingLabel(searchParams.get('label'));
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
  const groupLabelByEntityId = new Map(haDevices.map((d) => [d.entityId, getGroupLabel(d)]));
  const overrideMap = new Map(overrides.map((d) => [d.entityId, d]));

  const resolveDevice = (entityId: string) => {
    const ha = haMap.get(entityId);
    const override = overrideMap.get(entityId);
    const name = (override?.name ?? ha?.name ?? '').trim();
    const area = (override?.area ?? ha?.area ?? '').trim() || null;
    return { name, area };
  };

  const matchesAreaFilter = (area: string | null) => {
    if (!hasAreaFilter) return true;
    const normalized = (area ?? '').trim();
    if (normalized.length === 0) {
      return areasFilter.includes(UNASSIGNED);
    }
    return areasFilter.includes(normalized);
  };

  const readings = await prisma.boilerTemperatureReading.findMany({
    where: {
      haConnectionId,
      capturedAt: { gte: from, lte: to },
    },
    distinct: ['entityId'],
    orderBy: [{ entityId: 'asc' }],
    take: limit,
    select: { entityId: true, capturedAt: true },
  });
  const displayCtx = await buildMonitoringDisplayContext({
    haConnectionId,
    entityIds: Array.from(new Set(readings.map((row) => row.entityId))),
  });

  const prettyId = (id: string) => id.replace(/^sensor\./i, '').replace(/_/g, ' ');

  const boilerEntities = readings
    .map((row) => {
      const resolved = resolveDevice(row.entityId);
      const sourceArea = resolved.area?.trim() || null;
      const area = displayCtx.displayArea(row.entityId);
      const name = displayCtx.displayName(row.entityId) || prettyId(row.entityId);
      return {
        entityId: row.entityId,
        name,
        area,
        sourceArea: sourceArea || UNASSIGNED_AREA,
        label: displayCtx.displayLabel(row.entityId),
        sourceLabel: displayCtx.sourceLabel(row.entityId),
        lastCapturedAt: row.capturedAt.toISOString(),
      };
    })
    .filter((row) => {
      if (!displayCtx.isVisibleLabel(row.label)) return false;
      if (!requestedLabel) return true;
      const group = groupLabelByEntityId.get(row.entityId) ?? row.sourceLabel;
      return group ? group === requestedLabel : true; // degrade gracefully when HA labels unavailable
    })
    .filter((row) => matchesAreaFilter(row.area === UNASSIGNED_AREA ? null : row.area));

  return NextResponse.json({ ok: true, boilerEntities });
}
