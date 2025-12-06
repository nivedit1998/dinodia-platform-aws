import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { callHaService, fetchHaState, HaConnectionLike } from '@/lib/homeAssistant';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { checkRateLimit } from '@/lib/rateLimit';

const NUMERIC_COMMANDS = new Set([
  'light/set_brightness',
  'media/volume_set',
]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const allowed = checkRateLimit(`device-control:${user.id}`, {
    maxRequests: 30,
    windowMs: 10_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many actions, please slow down.' },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const { entityId, command, value } = body as {
    entityId?: string;
    command?: string;
    value?: number;
  };

  if (!entityId || !command) {
    return NextResponse.json(
      { ok: false, error: 'Missing entityId or command' },
      { status: 400 }
    );
  }

  if (NUMERIC_COMMANDS.has(command) && typeof value !== 'number') {
    return NextResponse.json(
      { ok: false, error: 'Command requires numeric value' },
      { status: 400 }
    );
  }

  try {
    const { haConnection } = await getUserWithHaConnection(user.id);
    const effectiveHa = resolveHaCloudFirst(haConnection);
    await handleCommand(effectiveHa, entityId, command, value);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('Device control error', err);
    const message = err instanceof Error ? err.message : 'Control failed';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

async function handleCommand(
  haConnection: HaConnectionLike,
  entityId: string,
  command: string,
  value?: number
) {
  const state = await fetchHaState(haConnection, entityId);
  const currentState = String(state.state ?? '');
  const domain = entityId.split('.')[0];
  const attrs = (state.attributes ?? {}) as Record<string, unknown>;

  switch (command) {
    case 'light/toggle':
      if (domain === 'light') {
        await callHaService(haConnection, 'light', currentState === 'on' ? 'turn_off' : 'turn_on', {
          entity_id: entityId,
        });
      } else {
        await callHaService(haConnection, 'homeassistant', 'toggle', { entity_id: entityId });
      }
      break;
    case 'light/set_brightness':
      if (domain !== 'light') throw new Error('Brightness supported only for lights');
      await callHaService(haConnection, 'light', 'turn_on', {
        entity_id: entityId,
        brightness_pct: clamp(value ?? 0, 0, 100),
      });
      break;
    case 'blind/open':
      await callHaService(haConnection, 'cover', 'open_cover', { entity_id: entityId });
      break;
    case 'blind/close':
      await callHaService(haConnection, 'cover', 'close_cover', { entity_id: entityId });
      break;
    case 'media/play_pause':
      await callHaService(
        haConnection,
        'media_player',
        currentState === 'playing' ? 'media_pause' : 'media_play',
        { entity_id: entityId }
      );
      break;
    case 'media/next':
      await callHaService(haConnection, 'media_player', 'media_next_track', {
        entity_id: entityId,
      });
      break;
    case 'media/previous':
      await callHaService(haConnection, 'media_player', 'media_previous_track', {
        entity_id: entityId,
      });
      break;
    case 'media/volume_up':
      await callHaService(haConnection, 'media_player', 'volume_up', {
        entity_id: entityId,
      });
      break;
    case 'media/volume_down':
      await callHaService(haConnection, 'media_player', 'volume_down', {
        entity_id: entityId,
      });
      break;
    case 'media/volume_set':
      await callHaService(haConnection, 'media_player', 'volume_set', {
        entity_id: entityId,
        volume_level: clamp((value ?? 0) / 100, 0, 1),
      });
      break;
    case 'boiler/temp_up':
    case 'boiler/temp_down': {
      const currentTemp =
        typeof attrs.temperature === 'number'
          ? (attrs.temperature as number)
          : typeof attrs.current_temperature === 'number'
          ? (attrs.current_temperature as number)
          : 20;
      const delta = command === 'boiler/temp_up' ? 1 : -1;
      const newTemp = currentTemp + delta;
      await callHaService(haConnection, 'climate', 'set_temperature', {
        entity_id: entityId,
        temperature: newTemp,
      });
      break;
    }
    case 'tv/toggle_power':
    case 'speaker/toggle_power':
      await callHaService(
        haConnection,
        'media_player',
        currentState === 'off' || currentState === 'standby' ? 'turn_on' : 'turn_off',
        { entity_id: entityId }
      );
      break;
    default:
      throw new Error(`Unsupported command ${command}`);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
