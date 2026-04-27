import { UIDevice } from '@/types/device';
import { getGroupLabel, getPrimaryLabel, OTHER_LABEL } from '@/lib/deviceLabels';
import { isDetailState } from '@/lib/deviceSensors';

export const DEVICE_COMMANDS = [
  'light/turn_on',
  'light/turn_off',
  'light/toggle',
  'light/set_brightness',
  'blind/set_position',
  'blind/open',
  'blind/close',
  'media/play_pause',
  'media/next',
  'media/previous',
  'media/volume_set',
  'media/volume_up',
  'media/volume_down',
  'tv/turn_on',
  'tv/turn_off',
  'tv/toggle_power',
  'speaker/turn_on',
  'speaker/turn_off',
  'speaker/toggle_power',
  'boiler/temp_up',
  'boiler/temp_down',
  'boiler/set_temperature',
] as const;

export type DeviceCommandId = (typeof DEVICE_COMMANDS)[number];

export function isDeviceCommandId(value: unknown): value is DeviceCommandId {
  return typeof value === 'string' && (DEVICE_COMMANDS as readonly string[]).includes(value);
}

type ActionSurface = 'dashboard' | 'automation';

type BaseActionSpec = {
  label?: string;
  surfaces?: ActionSurface[];
};

export type DeviceActionSpec =
  | (BaseActionSpec & {
      id: DeviceCommandId;
      kind: 'command';
    })
  | (BaseActionSpec & {
      id: DeviceCommandId;
      kind: 'slider';
      min: number;
      max: number;
      step?: number;
    })
  | (BaseActionSpec & {
      id: DeviceCommandId;
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

export type DeviceCapability = {
  label: string;
  actions: DeviceActionSpec[];
  triggers: DeviceTriggerSpec[];
  excludeFromAutomations?: boolean;
};

export const CAPABILITIES: Record<string, DeviceCapability> = {
  Light: {
    label: 'Light',
    actions: [
      { id: 'light/turn_on', kind: 'command', label: 'Turn on' },
      { id: 'light/turn_off', kind: 'command', label: 'Turn off' },
      {
        id: 'light/set_brightness',
        kind: 'slider',
        min: 0,
        max: 100,
        step: 1,
        label: 'Brightness',
      },
    ],
    triggers: [
      {
        type: 'attribute_delta',
        label: 'Brightness changed',
        attributes: ['brightness', 'brightness_pct'],
        directionOptions: ['increased', 'decreased'],
      },
    ],
  },
  Blind: {
    label: 'Blind',
    actions: [
      {
        id: 'blind/set_position',
        kind: 'slider',
        label: 'Set position',
        min: 0,
        max: 100,
        step: 1,
        surfaces: ['dashboard'],
      },
      {
        id: 'blind/set_position',
        kind: 'fixed-position',
        positions: [
          { value: 100, label: 'Open' },
          { value: 0, label: 'Close' },
        ],
        surfaces: ['automation'],
      },
    ],
    triggers: [
      {
        type: 'position_equals',
        label: 'Blind opened / closed',
        attributes: ['current_position', 'position'],
        values: [
          { value: 100, label: 'Opened' },
          { value: 0, label: 'Closed' },
        ],
      },
    ],
  },
  Boiler: {
    label: 'Boiler',
    actions: [
      { id: 'boiler/temp_up', kind: 'command', label: 'Temp up', surfaces: ['dashboard'] },
      { id: 'boiler/temp_down', kind: 'command', label: 'Temp down', surfaces: ['dashboard'] },
      {
        id: 'boiler/set_temperature',
        kind: 'slider',
        min: 5,
        max: 35,
        step: 0.5,
        label: 'Set temperature',
        surfaces: ['automation'],
      },
    ],
    triggers: [
      {
        type: 'attribute_delta',
        label: 'Current temperature changed',
        attributes: ['current_temperature'],
        directionOptions: ['increased', 'decreased'],
      },
    ],
  },
  Sockets: {
    label: 'Sockets',
    actions: [],
    triggers: [],
    excludeFromAutomations: true,
  },
  TV: {
    label: 'TV',
    actions: [
      { id: 'tv/turn_on', kind: 'command', label: 'Turn on' },
      { id: 'tv/turn_off', kind: 'command', label: 'Turn off' },
      { id: 'media/volume_set', kind: 'slider', min: 0, max: 100, step: 1, label: 'Volume' },
      { id: 'media/volume_up', kind: 'command', label: 'Volume up', surfaces: ['dashboard'] },
      { id: 'media/volume_down', kind: 'command', label: 'Volume down', surfaces: ['dashboard'] },
    ],
    triggers: [{ type: 'state_equals', label: 'Power', options: ['on', 'off'] }],
  },
  Speaker: {
    label: 'Speaker',
    actions: [
      { id: 'speaker/turn_on', kind: 'command', label: 'Turn on' },
      { id: 'speaker/turn_off', kind: 'command', label: 'Turn off' },
      { id: 'media/volume_set', kind: 'slider', min: 0, max: 100, step: 1, label: 'Volume' },
      { id: 'media/volume_up', kind: 'command', label: 'Volume up', surfaces: ['dashboard'] },
      { id: 'media/volume_down', kind: 'command', label: 'Volume down', surfaces: ['dashboard'] },
    ],
    triggers: [{ type: 'state_equals', label: 'Power', options: ['on', 'off'] }],
  },
  Spotify: {
    label: 'Spotify',
    actions: [
      { id: 'media/play_pause', kind: 'command', label: 'Play / Pause', surfaces: ['dashboard'] },
      { id: 'media/next', kind: 'command', label: 'Next', surfaces: ['dashboard'] },
      { id: 'media/previous', kind: 'command', label: 'Previous', surfaces: ['dashboard'] },
    ],
    triggers: [],
    excludeFromAutomations: true,
  },
  'Motion Sensor': {
    label: 'Motion Sensor',
    actions: [],
    triggers: [{ type: 'state_equals', label: 'Motion', options: ['on', 'off'] }],
  },
  Doorbell: {
    label: 'Doorbell',
    actions: [],
    triggers: [{ type: 'state_equals', label: 'Doorbell', options: ['on', 'off'] }],
  },
  'Home Security': {
    label: 'Home Security',
    actions: [],
    triggers: [{ type: 'state_equals', label: 'Security', options: ['on', 'off'] }],
  },
};

function isSurfaceAllowed(spec: { surfaces?: ActionSurface[] }, surface: ActionSurface) {
  return !spec.surfaces || spec.surfaces.includes(surface);
}

export function getCapabilitiesForDevice(device: UIDevice): DeviceCapability | null {
  const label = getPrimaryLabel(device);
  return CAPABILITIES[label] ?? null;
}

export function isAutomationExcluded(device: UIDevice) {
  const cap = getCapabilitiesForDevice(device);
  return cap?.excludeFromAutomations === true;
}

export function getActionsForDevice(
  device: UIDevice,
  surface: ActionSurface = 'dashboard'
): DeviceActionSpec[] {
  const cap = getCapabilitiesForDevice(device);
  if (!cap) return [];
  return cap.actions.filter((action) => isSurfaceAllowed(action, surface));
}

export function getTriggersForDevice(
  device: UIDevice,
  surface: ActionSurface = 'automation'
): DeviceTriggerSpec[] {
  const cap = getCapabilitiesForDevice(device);
  if (!cap) return [];
  return cap.triggers.filter((trigger) => isSurfaceAllowed(trigger, surface));
}

export function getTileEligibleDevicesForTenantDashboard(devices: UIDevice[]) {
  return devices.filter((d) => {
    const areaName = (d.area ?? d.areaName ?? '').trim();
    if (!areaName) return false;
    const cap = getCapabilitiesForDevice(d);
    if (!cap) return false;
    const label = getPrimaryLabel(d);
    const primary =
      !isDetailState(d.state) ||
      label === 'Sockets' ||
      label === 'Motion Sensor';
    if (!primary) return false;
    return getGroupLabel(d) !== OTHER_LABEL;
  });
}

export function getEligibleDevicesForAutomations(devices: UIDevice[]) {
  return devices.filter((d) => {
    const areaName = (d.area ?? d.areaName ?? '').trim();
    if (!areaName) return false;
    const cap = getCapabilitiesForDevice(d);
    if (!cap || cap.excludeFromAutomations) return false;
    return getGroupLabel(d) !== OTHER_LABEL;
  });
}

export function getBrightnessPercent(attrs: Record<string, unknown>) {
  const brightnessPct = attrs['brightness_pct'];
  if (typeof brightnessPct === 'number') {
    return Math.round(brightnessPct);
  }
  const brightness = attrs['brightness'];
  if (typeof brightness === 'number') {
    return Math.round((brightness / 255) * 100);
  }
  return null;
}

export function getVolumePercent(attrs: Record<string, unknown>) {
  const volumeLevel = attrs['volume_level'];
  if (typeof volumeLevel === 'number') {
    return Math.round(volumeLevel * 100);
  }
  return null;
}

export function getBlindPosition(attrs: Record<string, unknown>) {
  const raw =
    typeof attrs['current_position'] === 'number'
      ? (attrs['current_position'] as number)
      : typeof attrs['position'] === 'number'
      ? (attrs['position'] as number)
      : null;
  if (raw === null) return null;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

export function getTargetTemperature(attrs: Record<string, unknown>) {
  const temperature = attrs['temperature'];
  if (typeof temperature === 'number') return temperature;
  return null;
}

export function getCurrentTemperature(attrs: Record<string, unknown>) {
  const current = attrs['current_temperature'];
  if (typeof current === 'number') return current;
  return null;
}
