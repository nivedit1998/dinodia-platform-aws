import { getPrimaryLabel } from '@/lib/deviceLabels';
import { UIDevice } from '@/types/device';

export type ActionSurface = 'dashboard' | 'automation';

type BaseActionSpec = {
  label?: string;
  surfaces?: ActionSurface[];
};

export type DeviceActionSpec =
  | (BaseActionSpec & {
      id: string;
      kind: 'command';
    })
  | (BaseActionSpec & {
      id: string;
      kind: 'slider';
      min: number;
      max: number;
      step?: number;
    })
  | (BaseActionSpec & {
      id: string;
      kind: 'fixed-position';
      positions: { value: number; label: string }[];
    });

type BaseTriggerSpec = {
  label: string;
  surfaces?: ActionSurface[];
};

export type DeviceTriggerSpec =
  | (BaseTriggerSpec & {
      type: 'state_equals';
      options: string[];
    })
  | (BaseTriggerSpec & {
      type: 'attribute_delta';
      attributes: string[];
      directionOptions: Array<'increased' | 'decreased'>;
    })
  | (BaseTriggerSpec & {
      type: 'position_equals';
      attributes: string[];
      values: { value: number; label: string }[];
    });

export type DeviceServiceSpec = {
  serviceId: string;
  label: string;
  domain: string;
  service: string;
};

export type AlexaCapabilityProfile = {
  displayLabel: string;
  canPower: boolean;
  canBrightness: boolean;
  canPlayback: boolean;
  canVolume: boolean;
  canTemperature: boolean;
  isBlind: boolean;
};

export type DeviceCapabilityModel = {
  label: string;
  actions: DeviceActionSpec[];
  triggers: DeviceTriggerSpec[];
  advancedServices: DeviceServiceSpec[];
  excludeFromAutomations?: boolean;
  alexaProfile: AlexaCapabilityProfile;
};

const SAFE_HOMEASSISTANT_SERVICES = new Set([
  'homeassistant.turn_on',
  'homeassistant.turn_off',
  'homeassistant.toggle',
]);

function hasService(services: string[], serviceId: string) {
  return services.includes(serviceId);
}

function supportsAny(services: string[], candidates: string[]) {
  return candidates.some((serviceId) => hasService(services, serviceId));
}

function getSupportedColorModes(device: UIDevice) {
  const raw = device.attributes?.supported_color_modes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

function hasNumericAttribute(device: UIDevice, key: string) {
  return typeof device.attributes?.[key] === 'number';
}

function getTemperatureMin(device: UIDevice) {
  return typeof device.attributes?.min_temp === 'number' ? Number(device.attributes.min_temp) : 10;
}

function getTemperatureMax(device: UIDevice) {
  return typeof device.attributes?.max_temp === 'number' ? Number(device.attributes.max_temp) : 35;
}

function getTemperatureStep(device: UIDevice) {
  return typeof device.attributes?.target_temp_step === 'number'
    ? Number(device.attributes.target_temp_step)
    : 1;
}

function getPrimaryMediaPowerCommandIds(device: UIDevice) {
  const label = getPrimaryLabel(device);
  if (label === 'TV') {
    return { on: 'tv/turn_on', off: 'tv/turn_off' };
  }
  return { on: 'speaker/turn_on', off: 'speaker/turn_off' };
}

function buildAdvancedServices(device: UIDevice): DeviceServiceSpec[] {
  const services = Array.isArray(device.servicesForTarget) ? device.servicesForTarget : [];
  const allowed = services.filter((serviceId) => {
    if (SAFE_HOMEASSISTANT_SERVICES.has(serviceId)) return true;
    const [domain] = serviceId.split('.');
    return domain === device.domain;
  });

  return allowed.map((serviceId) => {
    const [domain, service] = serviceId.split('.');
    return {
      serviceId,
      domain,
      service,
      label: serviceId.replaceAll('_', ' '),
    };
  });
}

function buildLightLikeActions(device: UIDevice, services: string[]): DeviceActionSpec[] {
  const actions: DeviceActionSpec[] = [];
  const canTurnOn = supportsAny(services, ['light.turn_on', 'switch.turn_on', 'homeassistant.turn_on']);
  const canTurnOff = supportsAny(services, ['light.turn_off', 'switch.turn_off', 'homeassistant.turn_off']);
  const canToggle = supportsAny(services, ['light.toggle', 'switch.toggle', 'homeassistant.toggle']);

  if (canTurnOn) actions.push({ id: 'light/turn_on', kind: 'command', label: 'Turn on' });
  if (canTurnOff) actions.push({ id: 'light/turn_off', kind: 'command', label: 'Turn off' });
  if (!canTurnOn && !canTurnOff && canToggle) {
    actions.push({ id: 'light/toggle', kind: 'command', label: 'Toggle' });
  }

  if (device.domain === 'light') {
    const supportedColorModes = getSupportedColorModes(device);
    const isOnOffOnly =
      supportedColorModes.length > 0 &&
      supportedColorModes.length === 1 &&
      supportedColorModes[0] === 'onoff';
    if (!isOnOffOnly) {
      actions.push({
        id: 'light/set_brightness',
        kind: 'slider',
        min: 0,
        max: 100,
        step: 1,
        label: 'Brightness',
      });
    }
  }

  return actions;
}

function buildCoverActions(device: UIDevice, services: string[]): DeviceActionSpec[] {
  const actions: DeviceActionSpec[] = [];
  const canOpen = supportsAny(services, ['cover.open_cover', 'homeassistant.turn_on']);
  const canClose = supportsAny(services, ['cover.close_cover', 'homeassistant.turn_off']);
  const supportsPosition =
    supportsAny(services, ['cover.set_cover_position']) ||
    hasNumericAttribute(device, 'current_position') ||
    hasNumericAttribute(device, 'position');

  if (supportsPosition) {
    actions.push({
      id: 'blind/set_position',
      kind: 'slider',
      label: 'Set position',
      min: 0,
      max: 100,
      step: 1,
      surfaces: ['dashboard'],
    });
    actions.push({
      id: 'blind/set_position',
      kind: 'fixed-position',
      positions: [
        { value: 100, label: 'Open' },
        { value: 0, label: 'Close' },
      ],
      surfaces: ['automation'],
    });
  } else {
    if (canOpen) actions.push({ id: 'blind/open', kind: 'command', label: 'Open' });
    if (canClose) actions.push({ id: 'blind/close', kind: 'command', label: 'Close' });
  }

  return actions;
}

function buildMediaActions(device: UIDevice, services: string[]): DeviceActionSpec[] {
  const actions: DeviceActionSpec[] = [];
  const power = getPrimaryMediaPowerCommandIds(device);
  const canTurnOn = supportsAny(services, ['media_player.turn_on', 'homeassistant.turn_on']);
  const canTurnOff = supportsAny(services, ['media_player.turn_off', 'homeassistant.turn_off']);
  const canPlayPause = supportsAny(services, [
    'media_player.media_play_pause',
    'media_player.media_play',
    'media_player.media_pause',
  ]);
  const canNext = hasService(services, 'media_player.media_next_track');
  const canPrevious = hasService(services, 'media_player.media_previous_track');
  const canVolumeSet = hasService(services, 'media_player.volume_set');
  const canVolumeUp = hasService(services, 'media_player.volume_up');
  const canVolumeDown = hasService(services, 'media_player.volume_down');

  if (canTurnOn) actions.push({ id: power.on, kind: 'command', label: 'Turn on' });
  if (canTurnOff) actions.push({ id: power.off, kind: 'command', label: 'Turn off' });
  if (canPlayPause) actions.push({ id: 'media/play_pause', kind: 'command', label: 'Play / Pause' });
  if (canNext) actions.push({ id: 'media/next', kind: 'command', label: 'Next', surfaces: ['dashboard'] });
  if (canPrevious) actions.push({ id: 'media/previous', kind: 'command', label: 'Previous', surfaces: ['dashboard'] });
  if (canVolumeSet) {
    actions.push({
      id: 'media/volume_set',
      kind: 'slider',
      min: 0,
      max: 100,
      step: 1,
      label: 'Volume',
    });
  }
  if (canVolumeUp) actions.push({ id: 'media/volume_up', kind: 'command', label: 'Volume up', surfaces: ['dashboard'] });
  if (canVolumeDown) actions.push({ id: 'media/volume_down', kind: 'command', label: 'Volume down', surfaces: ['dashboard'] });

  return actions;
}

function buildClimateActions(device: UIDevice, services: string[]): DeviceActionSpec[] {
  if (!supportsAny(services, ['climate.set_temperature'])) return [];
  return [
    { id: 'boiler/temp_up', kind: 'command', label: 'Temp up', surfaces: ['dashboard'] },
    { id: 'boiler/temp_down', kind: 'command', label: 'Temp down', surfaces: ['dashboard'] },
    {
      id: 'boiler/set_temperature',
      kind: 'slider',
      min: getTemperatureMin(device),
      max: getTemperatureMax(device),
      step: getTemperatureStep(device),
      label: 'Set temperature',
      surfaces: ['dashboard', 'automation'],
    },
  ];
}

function buildTriggers(device: UIDevice, actions: DeviceActionSpec[]): DeviceTriggerSpec[] {
  if (device.domain === 'cover') {
    return [
      {
        type: 'position_equals',
        label: 'Blind opened / closed',
        attributes: ['current_position', 'position'],
        values: [
          { value: 100, label: 'Opened' },
          { value: 0, label: 'Closed' },
        ],
      },
    ];
  }

  if (device.domain === 'binary_sensor') {
    return [{ type: 'state_equals', label: 'State', options: ['on', 'off'] }];
  }

  if (device.domain === 'light') {
    const triggers: DeviceTriggerSpec[] = [{ type: 'state_equals', label: 'Power', options: ['on', 'off'] }];
    if (actions.some((action) => action.id === 'light/set_brightness')) {
      triggers.push({
        type: 'attribute_delta',
        label: 'Brightness changed',
        attributes: ['brightness', 'brightness_pct'],
        directionOptions: ['increased', 'decreased'],
      });
    }
    return triggers;
  }

  if (device.domain === 'climate') {
    return [
      {
        type: 'attribute_delta',
        label: 'Current temperature changed',
        attributes: ['current_temperature'],
        directionOptions: ['increased', 'decreased'],
      },
    ];
  }

  if (device.domain === 'media_player' || actions.some((action) => action.id === 'light/turn_on')) {
    return [{ type: 'state_equals', label: 'Power', options: ['on', 'off'] }];
  }

  return [];
}

export function getDeviceCapabilityModel(device: UIDevice): DeviceCapabilityModel {
  const services = Array.isArray(device.servicesForTarget) ? device.servicesForTarget : [];
  const label = getPrimaryLabel(device);
  let actions: DeviceActionSpec[] = [];

  switch (device.domain) {
    case 'light':
    case 'switch':
      actions = buildLightLikeActions(device, services);
      break;
    case 'cover':
      actions = buildCoverActions(device, services);
      break;
    case 'media_player':
      actions = buildMediaActions(device, services);
      break;
    case 'climate':
      actions = buildClimateActions(device, services);
      break;
    default:
      actions = buildLightLikeActions(device, services);
      break;
  }

  const triggers = buildTriggers(device, actions);
  const advancedServices = buildAdvancedServices(device);
  const alexaProfile: AlexaCapabilityProfile = {
    displayLabel: label,
    canPower: actions.some(
      (action) =>
        action.kind === 'command' &&
        ['light/turn_on', 'light/turn_off', 'tv/turn_on', 'tv/turn_off', 'speaker/turn_on', 'speaker/turn_off'].includes(action.id)
    ),
    canBrightness: actions.some((action) => action.kind === 'slider' && action.id === 'light/set_brightness'),
    canPlayback: actions.some(
      (action) =>
        action.kind === 'command' &&
        ['media/play_pause', 'media/next', 'media/previous'].includes(action.id)
    ),
    canVolume: actions.some(
      (action) =>
        (action.kind === 'slider' && action.id === 'media/volume_set') ||
        (action.kind === 'command' && ['media/volume_up', 'media/volume_down'].includes(action.id))
    ),
    canTemperature: actions.some((action) => action.id === 'boiler/set_temperature'),
    isBlind: device.domain === 'cover',
  };

  return {
    label,
    actions,
    triggers,
    advancedServices,
    excludeFromAutomations: actions.length === 0 && triggers.length === 0,
    alexaProfile,
  };
}
