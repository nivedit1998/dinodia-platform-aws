import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';

type HaState = {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    [key: string]: any;
  };
};

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    include: {
      haConnection: true,
      accessRules: true,
    },
  });

  if (!user || !user.haConnection) {
    return NextResponse.json(
      { error: 'HA connection not configured' },
      { status: 400 }
    );
  }

  const { baseUrl, longLivedToken } = user.haConnection;

  let states: HaState[] = [];
  try {
    const res = await fetch(`${baseUrl}/api/states`, {
      headers: {
        Authorization: `Bearer ${longLivedToken}`,
        'Content-Type': 'application/json',
      },
      // 5s timeout-ish via next.js? If needed we could add AbortController.
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('HA error:', text);
      return NextResponse.json(
        { error: 'Failed to fetch HA states' },
        { status: 502 }
      );
    }

    states = (await res.json()) as HaState[];
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to connect to HA' },
      { status: 502 }
    );
  }

  // Load any overrides for this HA connection (area/label/name)
  const dbDevices = await prisma.device.findMany({
    where: { haConnectionId: user.haConnection.id },
  });

  const deviceMap = new Map(
    dbDevices.map((d) => [d.entityId, d])
  );

  // Admin sees all HA entities, Tenant will be filtered by area
  const allowedAreas =
    user.role === Role.TENANT ? user.accessRules.map((r) => r.area) : null;

  const filteredStates =
    user.role === Role.TENANT && allowedAreas
      ? states.filter((s) => {
          const override = deviceMap.get(s.entity_id);
          const area = override?.area ?? null;
          return area !== null && allowedAreas.includes(area);
        })
      : states;

  const devices = filteredStates.map((s) => {
    const override = deviceMap.get(s.entity_id);
    const name = override?.name ?? s.attributes.friendly_name ?? s.entity_id;
    const area = override?.area ?? null;
    const label = override?.label ?? null;

    return {
      entityId: s.entity_id,
      name,
      state: s.state,
      area,
      label,
    };
  });

  return NextResponse.json({ devices });
}
