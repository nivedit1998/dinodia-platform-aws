import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { listHaAreaNames } from '@/lib/haAreas';
import { prisma } from '@/lib/prisma';

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
  let haConnection: Awaited<ReturnType<typeof getUserWithHaConnection>>['haConnection'];
  try {
    const resolved = await getUserWithHaConnection(me.id);
    const { user } = resolved;
    homeId = user.homeId!;
    haConnection = resolved.haConnection;
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

  const merged = new Map<string, string>();
  const addArea = (value: string | null | undefined) => {
    const normalized = (value ?? '').trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (!merged.has(key)) merged.set(key, normalized);
  };
  [...accessAreas, ...deviceAreas].forEach((entry) => addArea(entry.area));

  const candidates: HaConnectionLike[] = [];
  const seenBaseUrls = new Set<string>();
  const addCandidate = (candidate: HaConnectionLike) => {
    const key = candidate.baseUrl.trim().replace(/\/+$/, '').toLowerCase();
    if (!key || seenBaseUrls.has(key)) return;
    seenBaseUrls.add(key);
    candidates.push({
      baseUrl: candidate.baseUrl.trim(),
      longLivedToken: candidate.longLivedToken,
    });
  };

  addCandidate(resolveHaCloudFirst(haConnection));
  addCandidate({
    baseUrl: haConnection.baseUrl,
    longLivedToken: haConnection.longLivedToken,
  });

  for (const candidate of candidates) {
    try {
      const names = await listHaAreaNames(candidate);
      names.forEach((name) => addArea(name));
    } catch (err) {
      console.warn('[api/admin/areas] failed to fetch HA area registry list for candidate', {
        baseUrl: candidate.baseUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    areas: Array.from(merged.values()).sort((a, b) => a.localeCompare(b)),
  });
}
