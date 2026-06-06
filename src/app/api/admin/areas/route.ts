import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { prisma } from '@/lib/prisma';
import { normalizeDisplayText, normalizeLookupKey } from '@/lib/displayNormalization';

function addAreasFromHubSnapshot(
  addArea: (value: string | null | undefined) => void,
  snapshot: unknown
) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const obj = snapshot as Record<string, unknown>;
  const rawAreas = obj.areas;
  if (!Array.isArray(rawAreas)) return;
  for (const row of rawAreas) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (name) addArea(name);
  }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  let homeId: number;
  let haConnectionId: number;
  try {
    const resolved = await getUserWithHaConnection(me.id);
    const { user } = resolved;
    homeId = user.homeId!;
    haConnectionId = resolved.haConnection.id;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection is missing for this home.' },
      { status: 400 }
    );
  }

  const accessAreas = await prisma.accessRule.findMany({
    where: { user: { homeId } },
    select: { area: true },
  });

  const deviceAreas = await prisma.device.findMany({
    where: { haConnectionId },
    select: { area: true },
  });

  const hub = await prisma.home.findUnique({
    where: { id: homeId },
    select: {
      hubInstall: {
        select: {
          lastReportedHaAreas: true,
          lastReportedHaAreasAt: true,
          rooms: { select: { haAreaName: true } },
        },
      },
    },
  });

  const merged = new Map<string, string>();
  const addArea = (value: string | null | undefined) => {
    const normalized = (value ?? '').trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (!merged.has(key)) merged.set(key, normalized);
  };
  [...accessAreas, ...deviceAreas].forEach((entry) => addArea(entry.area));

  (hub?.hubInstall?.rooms ?? []).forEach((r) => addArea(r.haAreaName));
  addAreasFromHubSnapshot(addArea, hub?.hubInstall?.lastReportedHaAreas);

  const areas = Array.from(merged.values()).sort((a, b) => a.localeCompare(b));
  const overrides = await prisma.areaDisplayOverride.findMany({
    where: { haConnectionId, haAreaName: { in: areas } },
  });
  const overrideMap = new Map(overrides.map((override) => [override.haAreaName, override]));

  return NextResponse.json({
    ok: true,
    areas,
    areaOptions: areas.map((haAreaName) => {
      const override = overrideMap.get(haAreaName);
      return {
        haAreaName,
        displayName: override?.displayName ?? haAreaName,
        displayKey: override?.displayKey ?? normalizeLookupKey(haAreaName),
        hasOverride: Boolean(override),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  let haConnectionId: number;
  try {
    const resolved = await getUserWithHaConnection(me.id);
    haConnectionId = resolved.haConnection.id;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection is missing for this home.' },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const haAreaName = normalizeDisplayText(body?.haAreaName);
  const displayName = normalizeDisplayText(body?.displayName);
  if (!haAreaName || !displayName) {
    return NextResponse.json(
      { error: 'Please include the Home Assistant area and display name.' },
      { status: 400 }
    );
  }
  const displayKey = normalizeLookupKey(displayName);
  const override = await prisma.areaDisplayOverride.upsert({
    where: { haConnectionId_haAreaName: { haConnectionId, haAreaName } },
    update: { displayName, displayKey, createdByUserId: me.id },
    create: { haConnectionId, haAreaName, displayName, displayKey, createdByUserId: me.id },
  });
  await prisma.tenantVirtualArea.updateMany({
    where: { haConnectionId, parentHaAreaName: haAreaName },
    data: { parentAreaDisplaySnapshot: displayName },
  });
  return NextResponse.json({ ok: true, area: override });
}

export const PATCH = POST;
