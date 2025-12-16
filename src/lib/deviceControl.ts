import { callHaService, fetchHaState, HaConnectionLike } from '@/lib/homeAssistant';

const BLIND_OPEN_SCRIPT_ENTITY_ID =
  process.env.HA_BLIND_OPEN_SCRIPT_ENTITY_ID || 'script.openblind';
const BLIND_CLOSE_SCRIPT_ENTITY_ID =
  process.env.HA_BLIND_CLOSE_SCRIPT_ENTITY_ID || 'script.closeblind';

// Alexa-specific blind scripts (fallback to generic ones if not set)
const ALEXA_BLIND_OPEN_SCRIPT_ENTITY_ID =
  process.env.HA_ALEXA_BLIND_OPEN_SCRIPT_ENTITY_ID || BLIND_OPEN_SCRIPT_ENTITY_ID;
const ALEXA_BLIND_CLOSE_SCRIPT_ENTITY_ID =
  process.env.HA_ALEXA_BLIND_CLOSE_SCRIPT_ENTITY_ID || BLIND_CLOSE_SCRIPT_ENTITY_ID;

export const DEVICE_CONTROL_NUMERIC_COMMANDS = new Set([
  'light/set_brightness',
  'media/volume_set',
]);

type DeviceCommandSource = 'app' | 'alexa';

export async function executeDeviceCommand(
  haConnection: HaConnectionLike,
  entityId: string,
  command: string,
  value?: number,
  options?: { source?: DeviceCommandSource }
) {
  const source: DeviceCommandSource = options?.source ?? 'app';
  const state = await fetchHaState(haConnection, entityId);
  const currentState = String(state.state ?? '');
  const domain = entityId.split('.')[0];
  const attrs = (state.attributes ?? {}) as Record<string, unknown>;

  switch (command) {
    case 'light/toggle':
      if (domain === 'light') {
        await callHaService(
          haConnection,
          'light',
          currentState === 'on' ? 'turn_off' : 'turn_on',
          {
            entity_id: entityId,
          }
        );
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
    case 'blind/open': {
      const scriptEntityId =
        source === 'alexa' ? ALEXA_BLIND_OPEN_SCRIPT_ENTITY_ID : BLIND_OPEN_SCRIPT_ENTITY_ID;
      await callHaService(haConnection, 'script', 'turn_on', {
        entity_id: scriptEntityId,
      });
      break;
    }
    case 'blind/close': {
      const scriptEntityId =
        source === 'alexa' ? ALEXA_BLIND_CLOSE_SCRIPT_ENTITY_ID : BLIND_CLOSE_SCRIPT_ENTITY_ID;
      await callHaService(haConnection, 'script', 'turn_on', {
        entity_id: scriptEntityId,
      });
      break;
    }
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
