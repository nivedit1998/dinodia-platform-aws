import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { prisma } from '@/lib/prisma';

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

  return NextResponse.json({
    ok: true,
    areas: Array.from(merged.values()).sort((a, b) => a.localeCompare(b)),
  });
}
