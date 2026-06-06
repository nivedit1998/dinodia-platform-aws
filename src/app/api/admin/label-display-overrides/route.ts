import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { normalizeDisplayText, normalizeLookupKey } from '@/lib/displayNormalization';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }
  const { haConnection } = await getUserWithHaConnection(me.id);
  const overrides = await prisma.labelDisplayOverride.findMany({
    where: { haConnectionId: haConnection.id },
    orderBy: { displayName: 'asc' },
  });
  return NextResponse.json({ ok: true, overrides });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }
  const { haConnection } = await getUserWithHaConnection(me.id);
  const body = await req.json().catch(() => ({}));
  const sourceTechnicalLabel = normalizeDisplayText(body?.sourceTechnicalLabel);
  const canonicalLabel = normalizeDisplayText(body?.canonicalLabel) || sourceTechnicalLabel;
  const displayName = normalizeDisplayText(body?.displayName);
  if (!sourceTechnicalLabel || !displayName) {
    return NextResponse.json(
      { error: 'Please include the source label and display name.' },
      { status: 400 }
    );
  }
  const override = await prisma.labelDisplayOverride.upsert({
    where: {
      haConnectionId_sourceTechnicalLabel: {
        haConnectionId: haConnection.id,
        sourceTechnicalLabel,
      },
    },
    update: {
      canonicalLabel,
      displayName,
      displayKey: normalizeLookupKey(displayName),
      createdByUserId: me.id,
    },
    create: {
      haConnectionId: haConnection.id,
      sourceTechnicalLabel,
      canonicalLabel,
      displayName,
      displayKey: normalizeLookupKey(displayName),
      createdByUserId: me.id,
    },
  });
  return NextResponse.json({ ok: true, override });
}

export const PATCH = POST;
