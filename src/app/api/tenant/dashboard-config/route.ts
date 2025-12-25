import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || (me.role !== Role.TENANT && me.role !== Role.ADMIN)) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  try {
    const { haConnection } = await getUserWithHaConnection(me.id);
    const supportsHoliday = Boolean(
      haConnection.cloudUrl && haConnection.cloudUrl.trim().length > 0
    );
    return NextResponse.json({ supportsHoliday });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }
}
