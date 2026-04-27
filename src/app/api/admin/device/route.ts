import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { Role } from '@prisma/client';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  try {
    await requireTrustedAdminDevice(req, me.id);
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }

  const body = await req.json();
  const { entityId, name, blindTravelSeconds, area, label } = body;

  if (!entityId || !name) {
    return NextResponse.json(
      { error: 'Please include both the device name and the entity id.' },
      { status: 400 }
    );
  }

  let haConnectionId: number;
  try {
    const { haConnection } = await getUserWithHaConnection(me.id);
    haConnectionId = haConnection.id;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'The homeowner’s Dinodia Hub connection is missing for this home.' },
      { status: 400 }
    );
  }

  let blindTravelSecondsValue: number | null = null;
  if (blindTravelSeconds !== undefined && blindTravelSeconds !== null && blindTravelSeconds !== '') {
    const parsed = Number(blindTravelSeconds);
    if (Number.isFinite(parsed) && parsed > 0) {
      blindTravelSecondsValue = parsed;
    } else {
      return NextResponse.json(
        { error: 'Blind travel time must be a positive number of seconds when provided.' },
        { status: 400 }
      );
    }
  }

  const hasArea = Object.prototype.hasOwnProperty.call(body, 'area');
  const areaValue =
    typeof area === 'string' && area.trim().length > 0 ? area.trim() : null;

  const hasLabel = Object.prototype.hasOwnProperty.call(body, 'label');
  const labelValue =
    typeof label === 'string' && label.trim().length > 0 ? label.trim() : null;

  const updateData: {
    name: string;
    blindTravelSeconds: number | null;
    area?: string | null;
    label?: string | null;
  } = {
    name,
    blindTravelSeconds: blindTravelSecondsValue,
  };

  if (blindTravelSecondsValue !== null) {
    updateData.label = 'Blind';
  } else if (hasLabel) {
    updateData.label = labelValue;
  }

  if (hasArea) {
    updateData.area = areaValue;
  }

  const device = await prisma.device.upsert({
    where: {
      haConnectionId_entityId: {
        haConnectionId,
        entityId,
      },
    },
    update: updateData,
    create: {
      haConnectionId,
      entityId,
      name,
      area: hasArea ? areaValue : null,
      label:
        blindTravelSecondsValue !== null
          ? 'Blind'
          : hasLabel
            ? labelValue
            : null,
      blindTravelSeconds: blindTravelSecondsValue,
    },
  });

  return NextResponse.json({ ok: true, device });
}
