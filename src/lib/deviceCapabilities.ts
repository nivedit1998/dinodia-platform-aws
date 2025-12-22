import { UIDevice } from '@/types/device';
import { getPrimaryLabel } from '@/lib/deviceLabels';

export type DeviceCommandId =
  | 'light/toggle'
  | 'light/set_brightness'
  | 'blind/set_position'
  | 'media/play_pause'
  | 'media/next'
  | 'media/previous'
  | 'media/volume_set'
  | 'media/volume_up'
  | 'media/volume_down'
  | 'tv/toggle_power'
  | 'speaker/toggle_power'
  | 'boiler/temp_up'
  | 'boiler/temp_down'
  | 'boiler/set_temperature';

export type DeviceActionSpec =
  | {
      id: DeviceCommandId;
      kind: 'toggle';
      label?: string;
    }
  | {
      id: DeviceCommandId;
      kind: 'slider';
      label?: string;
      min: number;
      max: number;
      step?: number;
    }
  | {
      id: DeviceCommandId;
      kind: 'fixed-position';
      positions: { value: number; label: string }[];
    };

export type DeviceTriggerSpec =
  | {
      type: 'state_equals';
      label: string;
      options: string[];
    }
  | {
      type: 'attribute_delta';
      label: string;
      attribute: string;
      directionOptions: Array<'increased' | 'decreased'>;
    }
  | {
      type: 'position_equals';
      label: string;
      attribute: string;
      values: { value: number; label: string }[];
    };

export type DeviceCapability = {
  label: string;
  actions: DeviceActionSpec[];
  triggers: DeviceTriggerSpec[];
  excludeFromAutomations?: boolean;
};

const CAPABILITIES: Record<string, DeviceCapability> = {
  Light: {
    label: 'Light',
    actions: [
      { id: 'light/toggle', kind: 'toggle', label: 'On / Off' },
      { id: 'light/set_brightness', kind: 'slider', min: 0, max: 100, step: 1, label: 'Brightness' },
    ],
    triggers: [
      {
        type: 'attribute_delta',
        label: 'Brightness changed',
        attribute: 'brightness',
        directionOptions: ['increased', 'decreased'],
      },
    ],
  },
  Blind: {
    label: 'Blind',
    actions: [
      {
        id: 'blind/set_position',
        kind: 'fixed-position',
        positions: [
          { value: 100, label: 'Open' },
          { value: 0, label: 'Close' },
        ],
      },
    ],
    triggers: [
      {
        type: 'position_equals',
        label: 'Blind opened / closed',
        attribute: 'current_position',
        values: [
          { value: 100, label: 'Opened' },
          { value: 0, label: 'Closed' },
        ],
      },
    ],
  },
  Boiler: {
    label: 'Boiler',
    actions: [{ id: 'boiler/set_temperature', kind: 'slider', min: 5, max: 35, step: 0.5, label: 'Set temperature' }],
    triggers: [
      {
        type: 'attribute_delta',
        label: 'Current temperature changed',
        attribute: 'current_temperature',
        directionOptions: ['increased', 'decreased'],
      },
    ],
  },
  TV: {
    label: 'TV',
    actions: [{ id: 'tv/toggle_power', kind: 'toggle', label: 'On / Off' }],
    triggers: [
      { type: 'state_equals', label: 'Power', options: ['on', 'off'] },
    ],
  },
  Speaker: {
    label: 'Speaker',
    actions: [
      { id: 'speaker/toggle_power', kind: 'toggle', label: 'On / Off' },
      { id: 'media/volume_set', kind: 'slider', min: 0, max: 100, step: 1, label: 'Volume' },
    ],
    triggers: [
      { type: 'state_equals', label: 'Power', options: ['on', 'off'] },
    ],
  },
  Spotify: {
    label: 'Spotify',
    actions: [
      { id: 'media/play_pause', kind: 'toggle', label: 'Play / Pause' },
      { id: 'media/next', kind: 'toggle', label: 'Next' },
      { id: 'media/previous', kind: 'toggle', label: 'Previous' },
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

export function getCapabilitiesForDevice(device: UIDevice): DeviceCapability | null {
  const label = getPrimaryLabel(device);
  return CAPABILITIES[label] ?? null;
}

export function isAutomationExcluded(device: UIDevice) {
  const cap = getCapabilitiesForDevice(device);
  return cap?.excludeFromAutomations === true;
}

export function getAutomationEligibleDevices(devices: UIDevice[]) {
  return devices.filter((d) => {
    const cap = getCapabilitiesForDevice(d);
    return cap && !cap.excludeFromAutomations;
  });
}

export function getActionsForDevice(device: UIDevice): DeviceActionSpec[] {
  return getCapabilitiesForDevice(device)?.actions ?? [];
}

export function getTriggersForDevice(device: UIDevice): DeviceTriggerSpec[] {
  return getCapabilitiesForDevice(device)?.triggers ?? [];
}
