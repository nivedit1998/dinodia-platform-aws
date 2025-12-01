import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';

function normalizeHaBaseUrl(value: string) {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid HA base URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('HA base URL must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
}

async function ensureAdminWithConnection(adminId: number) {
  try {
    return await getUserWithHaConnection(adminId);
  } catch {
    throw new Error('HA connection not configured');
  }
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { haConnection } = await ensureAdminWithConnection(me.id);
    return NextResponse.json({
      haUsername: haConnection.haUsername ?? '',
      haBaseUrl: haConnection.baseUrl ?? '',
      hasHaPassword: Boolean(haConnection.haPassword),
      hasLongLivedToken: Boolean(haConnection.longLivedToken),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Unable to load HA settings' },
      { status: 400 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    haUsername?: string;
    haPassword?: string;
    haBaseUrl?: string;
    haLongLivedToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { haUsername, haPassword, haBaseUrl, haLongLivedToken } = body ?? {};

  if (typeof haUsername !== 'string' || !haUsername.trim()) {
    return NextResponse.json({ error: 'HA username is required' }, { status: 400 });
  }
  if (typeof haBaseUrl !== 'string' || !haBaseUrl.trim()) {
    return NextResponse.json({ error: 'HA base URL is required' }, { status: 400 });
  }

  let normalizedBaseUrl: string;
  try {
    normalizedBaseUrl = normalizeHaBaseUrl(haBaseUrl);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  let haContext;
  try {
    haContext = await ensureAdminWithConnection(me.id);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'HA connection not configured' },
      { status: 400 }
    );
  }

  const updateData: {
    haUsername: string;
    baseUrl: string;
    haPassword?: string;
    longLivedToken?: string;
  } = {
    haUsername: haUsername.trim(),
    baseUrl: normalizedBaseUrl,
  };

  if (typeof haPassword === 'string' && haPassword.length > 0) {
    updateData.haPassword = haPassword;
  }
  if (typeof haLongLivedToken === 'string' && haLongLivedToken.length > 0) {
    updateData.longLivedToken = haLongLivedToken;
  }

  const updated = await prisma.haConnection.update({
    where: { id: haContext.haConnection.id },
    data: updateData,
    select: {
      haUsername: true,
      baseUrl: true,
      haPassword: true,
      longLivedToken: true,
    },
  });

  return NextResponse.json({
    ok: true,
    haUsername: updated.haUsername ?? '',
    haBaseUrl: updated.baseUrl ?? '',
    hasHaPassword: Boolean(updated.haPassword),
    hasLongLivedToken: Boolean(updated.longLivedToken),
  });
}
