import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { listAllowedDiscoveryFlows } from '@/lib/haDiscovery';

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  let ha;
  try {
    const { haConnection } = await getUserWithHaConnection(me.id);
    ha = resolveHaCloudFirst(haConnection);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Dinodia Hub connection isn't set up yet for this home." },
      { status: 400 }
    );
  }

  try {
    const flows = await listAllowedDiscoveryFlows(ha);
    return NextResponse.json({ flows });
  } catch (err) {
    console.error('[api/tenant/homeassistant/discovery] Failed to list discovery flows', err);
    return NextResponse.json(
      { error: 'We could not fetch discovered devices from your Dinodia Hub right now. Please try again.' },
      { status: 502 }
    );
  }
}
