import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { buildAdminHeatingDashboard } from '@/lib/adminHeatingDashboard';

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

  try {
    const { searchParams } = new URL(req.url);
    const payload = await buildAdminHeatingDashboard({ haConnectionId, searchParams });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'We could not load heating dashboard data right now. Please try again.' },
      { status: 400 }
    );
  }
}
