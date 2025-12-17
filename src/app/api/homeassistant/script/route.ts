import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { callHaService } from '@/lib/homeAssistant';

type BlindScriptName = 'openblind' | 'closeblind' | 'openblindfully' | 'closeblindfully';

const SCRIPT_MAP: Record<BlindScriptName, string> = {
  openblind: process.env.HA_BLIND_OPEN_SCRIPT_ENTITY_ID || 'script.openblind',
  closeblind: process.env.HA_BLIND_CLOSE_SCRIPT_ENTITY_ID || 'script.closeblind',
  openblindfully:
    process.env.HA_BLIND_OPEN_FULLY_SCRIPT_ENTITY_ID || 'script.openblindfully',
  closeblindfully:
    process.env.HA_BLIND_CLOSE_FULLY_SCRIPT_ENTITY_ID || 'script.closeblindfully',
};

const DEFAULT_BLIND_TRAVEL_SECONDS = Number(process.env.HA_BLIND_TRAVEL_SECONDS || '22');

export async function POST(req: NextRequest) {
  // TODO: depending on how you wire the ChatGPT assistant,
  // you might want a different auth mechanism (e.g., a shared secret header).
  // For now, reuse the standard user session.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { script, entityId, travel_seconds } = body as {
    script?: string;
    entityId?: string;
    travel_seconds?: number;
  };

  if (!script || !entityId) {
    return NextResponse.json({ error: 'Missing script or entityId' }, { status: 400 });
  }

  if (!['openblind', 'closeblind', 'openblindfully', 'closeblindfully'].includes(script)) {
    return NextResponse.json({ error: 'Invalid script name' }, { status: 400 });
  }

  if (!entityId.startsWith('cover.')) {
    return NextResponse.json({ error: 'entityId must be a cover.* entity' }, { status: 400 });
  }

  const scriptKey = script as BlindScriptName;
  const scriptEntityId = SCRIPT_MAP[scriptKey];

  const travelSeconds =
    typeof travel_seconds === 'number' ? travel_seconds : DEFAULT_BLIND_TRAVEL_SECONDS;

  try {
    const { haConnection } = await getUserWithHaConnection(user.id);
    const effectiveHa = resolveHaCloudFirst(haConnection);

    await callHaService(effectiveHa, 'script', 'turn_on', {
      entity_id: scriptEntityId,
      variables: {
        target_cover: entityId,
        travel_seconds: travelSeconds,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/homeassistant/script] error', err);
    return NextResponse.json(
      { error: 'Failed to call Home Assistant script' },
      { status: 500 }
    );
  }
}
