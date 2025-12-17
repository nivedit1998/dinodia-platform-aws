import {
  AlexaDeviceStateLike,
  AlexaProperty,
  buildAlexaPropertiesForDevice,
} from '@/lib/alexaProperties';
import { sendAlexaChangeReport } from '@/lib/alexaEvents';
import { callHaService, fetchHaState, HaConnectionLike } from '@/lib/homeAssistant';

const BLIND_GLOBAL_CONTROLLER_SCRIPT_ENTITY_ID =
  process.env.HA_BLIND_GLOBAL_CONTROLLER_SCRIPT_ENTITY_ID ||
  'script.global_blind_controller';
const BLIND_GLOBAL_CONTROLLER_SCRIPT_SERVICE =
  BLIND_GLOBAL_CONTROLLER_SCRIPT_ENTITY_ID.startsWith('script.')
    ? BLIND_GLOBAL_CONTROLLER_SCRIPT_ENTITY_ID.slice('script.'.length)
    : null;

const DEFAULT_BLIND_TRAVEL_SECONDS = Number(process.env.HA_BLIND_TRAVEL_SECONDS || '22');

export const DEVICE_CONTROL_NUMERIC_COMMANDS = new Set([
  'light/set_brightness',
  'media/volume_set',
  'blind/set_position',
]);

type DeviceCommandSource = 'app' | 'alexa';
type DeviceCommandOptions = {
  source?: DeviceCommandSource;
  userId?: number;
};

const ALEXA_REPORTABLE_COMMANDS: Record<string, { label: string }> = {
  'light/toggle': { label: 'light' },
  'light/set_brightness': { label: 'light' },
  'blind/set_position': { label: 'blind' },
  'blind/open': { label: 'blind' },
  'blind/close': { label: 'blind' },
  'tv/toggle_power': { label: 'tv' },
  'speaker/toggle_power': { label: 'speaker' },
  'boiler/temp_up': { label: 'boiler' },
  'boiler/temp_down': { label: 'boiler' },
};

function getAlexaLabelForCommand(command: string): string | null {
  return ALEXA_REPORTABLE_COMMANDS[command]?.label ?? null;
}

export async function executeDeviceCommand(
  haConnection: HaConnectionLike,
  entityId: string,
  command: string,
  value?: number,
  options?: DeviceCommandOptions
) {
  const source: DeviceCommandSource = options?.source ?? 'app';
  const userId = options?.userId;
  console.log('AlexaChangeReport: executeDeviceCommand', {
    entityId,
    command,
    source,
    alexaLabel: getAlexaLabelForCommand(command) ?? null,
  });
  const state = await fetchHaState(haConnection, entityId);
  const currentState = String(state.state ?? '');
  const domain = entityId.split('.')[0];
  const attrs = (state.attributes ?? {}) as Record<string, unknown>;
  const alexaLabel = getAlexaLabelForCommand(command);
  const previousSnapshot: AlexaChangeReportSnapshot | null = alexaLabel
    ? {
        entityId,
        state: currentState,
        attributes: attrs,
        label: alexaLabel,
      }
    : null;

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
    case 'blind/set_position': {
      const target = clamp(value ?? 0, 0, 100);
      await callBlindGlobalController(haConnection, {
        target_cover: entityId,
        target_position: target,
        travel_seconds: DEFAULT_BLIND_TRAVEL_SECONDS,
      });
      break;
    }
    case 'blind/open': {
      await callBlindGlobalController(haConnection, {
        target_cover: entityId,
        target_position: 100,
        travel_seconds: DEFAULT_BLIND_TRAVEL_SECONDS,
      });
      break;
    }
    case 'blind/close': {
      await callBlindGlobalController(haConnection, {
        target_cover: entityId,
        target_position: 0,
        travel_seconds: DEFAULT_BLIND_TRAVEL_SECONDS,
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

  if (previousSnapshot) {
    await scheduleAlexaChangeReport(haConnection, previousSnapshot, source, userId);
  }
}

async function callBlindGlobalController(
  haConnection: HaConnectionLike,
  payload: {
    target_cover: string;
    target_position: number;
    travel_seconds: number;
  }
) {
  try {
    if (BLIND_GLOBAL_CONTROLLER_SCRIPT_SERVICE) {
      await callHaService(haConnection, 'script', BLIND_GLOBAL_CONTROLLER_SCRIPT_SERVICE, payload);
      return;
    }

    await callHaService(haConnection, 'script', 'turn_on', {
      entity_id: BLIND_GLOBAL_CONTROLLER_SCRIPT_ENTITY_ID,
      variables: payload,
    });
  } catch (err) {
    if (isHaTimeoutError(err)) {
      console.warn('[deviceControl] Blind script timed out (continuing)', {
        entityId: payload.target_cover,
      });
      return;
    }
    throw err;
  }
}

function isHaTimeoutError(err: unknown): err is Error {
  return err instanceof Error && err.message.toLowerCase().includes('timeout');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_CHANGE_REPORT_DELAY_MS = 500;
const DEFAULT_LIGHT_CHANGE_REPORT_DELAY_MS = 4000;
const DEFAULT_BLIND_CHANGE_REPORT_DELAY_MS = 30000;

function getChangeReportDelayMs(label: string) {
  const normalized = label.toLowerCase();

  const parseDelay = (raw: string | undefined | null, fallback: number) => {
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  if (normalized === 'blind') {
    return parseDelay(
      process.env.ALEXA_EVENT_STATE_REFRESH_DELAY_BLIND_MS,
      DEFAULT_BLIND_CHANGE_REPORT_DELAY_MS
    );
  }

  if (normalized === 'light') {
    return parseDelay(
      process.env.ALEXA_EVENT_STATE_REFRESH_DELAY_LIGHT_MS,
      DEFAULT_LIGHT_CHANGE_REPORT_DELAY_MS
    );
  }

  return parseDelay(process.env.ALEXA_EVENT_STATE_REFRESH_DELAY_MS, DEFAULT_CHANGE_REPORT_DELAY_MS);
}

type AlexaChangeReportSnapshot = AlexaDeviceStateLike & { label: string };

async function scheduleAlexaChangeReport(
  haConnection: HaConnectionLike,
  snapshot: AlexaChangeReportSnapshot,
  source: DeviceCommandSource,
  userId?: number
) {
  if (!shouldSendAlexaEvents()) {
    console.log('AlexaChangeReport: skipping scheduleAlexaChangeReport', {
      entityId: snapshot.entityId,
      commandLabel: snapshot.label,
      source,
      reason: 'shouldSendAlexaEvents=false',
    });
    return;
  }

  const previousProperties = buildAlexaPropertiesForDevice(snapshot, snapshot.label);
  if (previousProperties.length === 0) {
    console.log('AlexaChangeReport: skipping, no previous properties', {
      entityId: snapshot.entityId,
      label: snapshot.label,
    });
    return;
  }

  const causeType =
    source === 'alexa'
      ? 'VOICE_INTERACTION'
      : source === 'app'
      ? 'APP_INTERACTION'
      : 'PHYSICAL_INTERACTION';

  const delayMs = getChangeReportDelayMs(snapshot.label);

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  let latestState = snapshot.state;
  let latestAttrs = snapshot.attributes;
  try {
    const refreshed = await fetchHaState(haConnection, snapshot.entityId);
    latestState = String(refreshed.state ?? latestState);
    latestAttrs = (refreshed.attributes ?? {}) as Record<string, unknown>;
  } catch (err) {
    console.warn(
      '[deviceControl] Failed to refresh HA state for Alexa ChangeReport',
      snapshot.entityId,
      err
    );
  }

  const nextProperties = buildAlexaPropertiesForDevice(
    {
      entityId: snapshot.entityId,
      state: latestState,
      attributes: latestAttrs,
      label: snapshot.label,
    },
    snapshot.label
  );

  if (nextProperties.length === 0) {
    console.log('AlexaChangeReport: skipping, no next properties', {
      entityId: snapshot.entityId,
      label: snapshot.label,
    });
    return;
  }

  if (!haveAlexaPropertiesChanged(previousProperties, nextProperties)) {
    console.log('AlexaChangeReport: skipping, properties unchanged', {
      entityId: snapshot.entityId,
      label: snapshot.label,
    });
    return;
  }

  if (!userId) {
    console.log('AlexaChangeReport: skipping, missing userId', {
      entityId: snapshot.entityId,
      label: snapshot.label,
    });
    return;
  }

  try {
    console.log('AlexaChangeReport: sending', {
      endpointId: snapshot.entityId,
      label: snapshot.label,
      causeType,
      namespaces: nextProperties.map((p) => p.namespace),
    });
    await sendAlexaChangeReport(userId, snapshot.entityId, nextProperties, causeType);
  } catch (err) {
    console.error(
      '[deviceControl] Failed to send Alexa ChangeReport',
      snapshot.entityId,
      err
    );
  }
}

function haveAlexaPropertiesChanged(prev: AlexaProperty[], next: AlexaProperty[]) {
  if (prev.length !== next.length) return true;
  const normalize = (props: AlexaProperty[]) =>
    props.map((prop) => ({
      namespace: prop.namespace,
      name: prop.name,
      instance: prop.instance ?? null,
      value: prop.value,
    }));

  return JSON.stringify(normalize(prev)) !== JSON.stringify(normalize(next));
}

function shouldSendAlexaEvents(): boolean {
  const hasGateway = !!process.env.ALEXA_EVENT_GATEWAY_ENDPOINT;
  const hasEventsClientId = !!process.env.ALEXA_EVENTS_CLIENT_ID;
  const hasEventsClientSecret = !!process.env.ALEXA_EVENTS_CLIENT_SECRET;

  const ok = hasGateway && hasEventsClientId && hasEventsClientSecret;

  console.log('AlexaChangeReport: shouldSendAlexaEvents', {
    hasGateway,
    hasEventsClientId,
    hasEventsClientSecret,
    ok,
  });

  return ok;
}
