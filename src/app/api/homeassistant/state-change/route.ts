import { NextRequest, NextResponse } from 'next/server';
import { scheduleAlexaChangeReportForEntityStateChange } from '@/lib/deviceControl';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { prisma } from '@/lib/prisma';

const WEBHOOK_SECRET = process.env.HA_WEBHOOK_SECRET;
const FALLBACK_EVENTS_USER_ID = Number(process.env.ALEXA_EVENTS_USER_ID || NaN);

type HaResolution = {
  haConnection: {
    baseUrl: string;
    cloudUrl: string | null;
    longLivedToken: string;
  };
  userId: number;
};

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function resolveHaForEntity(entityId: string): Promise<HaResolution | null> {
  try {
    const device = await prisma.device.findFirst({
      where: { entityId },
      include: { haConnection: true },
    });
    if (device?.haConnection) {
      return {
        haConnection: device.haConnection,
        userId: device.haConnection.ownerId,
      };
    }
  } catch (err) {
    console.warn('[api/homeassistant/state-change] Failed to resolve device', { entityId, err });
  }

  if (Number.isFinite(FALLBACK_EVENTS_USER_ID)) {
    try {
      const { user, haConnection } = await getUserWithHaConnection(FALLBACK_EVENTS_USER_ID);
      return { haConnection, userId: user.id };
    } catch (err) {
      console.warn('[api/homeassistant/state-change] Failed fallback HA resolution', {
        entityId,
        userId: FALLBACK_EVENTS_USER_ID,
        err,
      });
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error('[api/homeassistant/state-change] Missing HA_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const token = getBearerToken(req);
  if (token !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const entityId =
    typeof (body as Record<string, unknown>).entity_id === 'string'
      ? ((body as Record<string, unknown>).entity_id as string)
      : typeof (body as Record<string, unknown>).entityId === 'string'
      ? ((body as Record<string, unknown>).entityId as string)
      : null;

  if (!entityId) {
    return NextResponse.json({ error: 'Missing entity_id' }, { status: 400 });
  }

  const haResolution = await resolveHaForEntity(entityId);
  if (!haResolution) {
    console.warn('[api/homeassistant/state-change] No HA connection for entity', { entityId });
    return NextResponse.json(
      { ok: true, warning: 'No HA connection found for that entity' },
      { status: 200 }
    );
  }

  const { haConnection, userId } = haResolution;
  const effectiveHa = resolveHaCloudFirst(haConnection);

  try {
    await scheduleAlexaChangeReportForEntityStateChange(effectiveHa, entityId, 'physical', userId);
  } catch (err) {
    console.warn('[api/homeassistant/state-change] Failed to schedule Alexa ChangeReport', {
      entityId,
      err,
    });
    return NextResponse.json(
      { ok: true, warning: 'Failed to schedule Alexa ChangeReport' },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true });
}
