import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { callHaService } from '@/lib/homeAssistant';

type BlindScriptName = 'openblind' | 'closeblind' | 'openblindfully' | 'closeblindfully';

const LEGACY_SCRIPT_NAMES: BlindScriptName[] = [
  'openblind',
  'closeblind',
  'openblindfully',
  'closeblindfully',
];

const SCRIPT_MAP: Record<BlindScriptName, string> = {
  openblind: process.env.HA_BLIND_OPEN_SCRIPT_ENTITY_ID || 'script.openblind',
  closeblind: process.env.HA_BLIND_CLOSE_SCRIPT_ENTITY_ID || 'script.closeblind',
  openblindfully:
    process.env.HA_BLIND_OPEN_FULLY_SCRIPT_ENTITY_ID || 'script.openblindfully',
  closeblindfully:
    process.env.HA_BLIND_CLOSE_FULLY_SCRIPT_ENTITY_ID || 'script.closeblindfully',
};

const DEFAULT_BLIND_TRAVEL_SECONDS = Number(process.env.HA_BLIND_TRAVEL_SECONDS || '22');
const GLOBAL_BLIND_CONTROLLER_SCRIPT_ENTITY_ID =
  process.env.HA_BLIND_GLOBAL_CONTROLLER_SCRIPT_ENTITY_ID || 'script.global_blind_controller';
const GLOBAL_BLIND_CONTROLLER_SCRIPT_SERVICE =
  GLOBAL_BLIND_CONTROLLER_SCRIPT_ENTITY_ID.startsWith('script.')
    ? GLOBAL_BLIND_CONTROLLER_SCRIPT_ENTITY_ID.slice('script.'.length)
    : null;

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

  const { script, entityId, travel_seconds, target_position } = body as {
    script?: string;
    entityId?: string;
    travel_seconds?: number;
    target_position?: number;
  };

  if (!script || !entityId) {
    return NextResponse.json({ error: 'Missing script or entityId' }, { status: 400 });
  }

  const isLegacyScript = LEGACY_SCRIPT_NAMES.includes(script as BlindScriptName);
  const isGlobalController = script === 'global_blind_controller';

  if (!isLegacyScript && !isGlobalController) {
    return NextResponse.json({ error: 'Invalid script name' }, { status: 400 });
  }

  if (!entityId.startsWith('cover.')) {
    return NextResponse.json({ error: 'entityId must be a cover.* entity' }, { status: 400 });
  }

  const travelSeconds =
    typeof travel_seconds === 'number' ? travel_seconds : DEFAULT_BLIND_TRAVEL_SECONDS;

  if (isGlobalController) {
    if (typeof target_position !== 'number' || Number.isNaN(target_position)) {
      return NextResponse.json(
        { error: 'target_position must be provided as a number' },
        { status: 400 }
      );
    }
    if (target_position < 0 || target_position > 100) {
      return NextResponse.json(
        { error: 'target_position must be between 0 and 100' },
        { status: 400 }
      );
    }
  }

  try {
    const { haConnection } = await getUserWithHaConnection(user.id);
    const effectiveHa = resolveHaCloudFirst(haConnection);

    if (isGlobalController) {
      const targetPosition = target_position as number;
      if (GLOBAL_BLIND_CONTROLLER_SCRIPT_SERVICE) {
        await callHaService(effectiveHa, 'script', GLOBAL_BLIND_CONTROLLER_SCRIPT_SERVICE, {
          target_cover: entityId,
          target_position: targetPosition,
          travel_seconds: travelSeconds,
        });
      } else {
        await callHaService(effectiveHa, 'script', 'turn_on', {
          entity_id: GLOBAL_BLIND_CONTROLLER_SCRIPT_ENTITY_ID,
          variables: {
            target_cover: entityId,
            target_position: targetPosition,
            travel_seconds: travelSeconds,
          },
        });
      }
    } else {
      const scriptKey = script as BlindScriptName;
      const scriptEntityId = SCRIPT_MAP[scriptKey];
      await callHaService(effectiveHa, 'script', 'turn_on', {
        entity_id: scriptEntityId,
        variables: {
          target_cover: entityId,
          travel_seconds: travelSeconds,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isHaTimeoutError(err)) {
      console.warn('[api/homeassistant/script] Blind script timeout (continuing)', {
        entityId,
      });
      return NextResponse.json({
        ok: true,
        warning: 'Home Assistant is still moving that blind.',
      });
    }
    console.error('[api/homeassistant/script] error', err);
    return NextResponse.json(
      { error: 'Failed to call Home Assistant script' },
      { status: 500 }
    );
  }
}

function isHaTimeoutError(err: unknown): err is Error {
  return err instanceof Error && err.message.toLowerCase().includes('timeout');
}
