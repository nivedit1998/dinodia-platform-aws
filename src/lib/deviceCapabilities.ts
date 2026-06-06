import { getGroupLabel, OTHER_LABEL, REMOTE_LABEL } from '@/lib/deviceLabels';
import { getDeviceCapabilityModel } from '@/lib/haEntityCapabilities';
import type {
  ActionSurface,
  DeviceActionSpec,
  DeviceServiceSpec,
  DeviceTriggerSpec,
} from '@/lib/haEntityCapabilities';
import { isDetailState } from '@/lib/deviceSensors';
import { UIDevice } from '@/types/device';

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
  'boiler/turn_on',
  'boiler/turn_off',
  'boiler/temp_up',
  'boiler/temp_down',
  'boiler/set_temperature',
] as const;

export type DeviceCommandId = (typeof DEVICE_COMMANDS)[number];

const CAPABILITY_LABELS = [
  'Light',
  'Blind',
  'Motion Sensor',
  'Spotify',
  'Boiler',
  'Radiator',
  'Doorbell',
  'Home Security',
  'TV',
  'Speaker',
] as const;

export const CAPABILITIES = Object.fromEntries(
  CAPABILITY_LABELS.map((label) => [label, {}])
) as Record<(typeof CAPABILITY_LABELS)[number], Record<string, never>>;

export type { ActionSurface, DeviceActionSpec, DeviceTriggerSpec, DeviceServiceSpec };

export function isDeviceCommandId(value: unknown): value is DeviceCommandId {
  return typeof value === 'string' && (DEVICE_COMMANDS as readonly string[]).includes(value);
}

function isSurfaceAllowed(spec: { surfaces?: ActionSurface[] }, surface: ActionSurface) {
  return !spec.surfaces || spec.surfaces.includes(surface);
}

export function getCapabilitiesForDevice(device: UIDevice) {
  return getDeviceCapabilityModel(device);
}

export function isAutomationExcluded(device: UIDevice) {
  return getCapabilitiesForDevice(device).excludeFromAutomations === true;
}

export function getActionsForDevice(
  device: UIDevice,
  surface: ActionSurface = 'dashboard'
): DeviceActionSpec[] {
  return getCapabilitiesForDevice(device).actions.filter((action) => isSurfaceAllowed(action, surface));
}

export function getTriggersForDevice(
  device: UIDevice,
  surface: ActionSurface = 'automation'
): DeviceTriggerSpec[] {
  return getCapabilitiesForDevice(device).triggers.filter((trigger) =>
    isSurfaceAllowed(trigger, surface)
  );
}

export function getAdvancedServicesForDevice(device: UIDevice): DeviceServiceSpec[] {
  return getCapabilitiesForDevice(device).advancedServices;
}

export function getTileEligibleDevicesForTenantDashboard(devices: UIDevice[]) {
  return devices.filter((d) => {
    const areaName = (d.displayAreaName ?? d.areaName ?? d.area ?? '').trim();
    if (!areaName) return false;
    const cap = getCapabilitiesForDevice(d);
    if (!cap) return false;
    const primary = !isDetailState(d.state) || cap.label === 'Motion Sensor';
    if (!primary) return false;
    const group = getGroupLabel(d);
    return group !== OTHER_LABEL && group !== REMOTE_LABEL;
  });
}

export function getTenantDashboardDevices(devices: UIDevice[]) {
  // Phase 2 source of truth: match what the tenant dashboard can meaningfully render as a tile.
  // Intentionally does not apply "excludeFromAutomations" filtering; automations can filter separately.
  return devices.filter((d) => {
    const areaName = (d.displayAreaName ?? d.areaName ?? d.area ?? '').trim();
    if (!areaName) return false;
    const cap = getCapabilitiesForDevice(d);
    if (!cap) return false;
    // Allow devices that are temporarily unavailable/numeric as long as they belong to a real dashboard group.
    // (Dashboard itself decides how to render them; automations will only show devices with supported actions/triggers.)
    const group = getGroupLabel(d);
    return group !== OTHER_LABEL && group !== REMOTE_LABEL;
  });
}

export function getPrimaryAutomationActions(device: UIDevice): DeviceActionSpec[] {
  // Primary = same surface used by tenant dashboard device cards.
  return getActionsForDevice(device, 'dashboard');
}

export function getAdvancedAutomationServices(device: UIDevice): DeviceServiceSpec[] {
  // Advanced = dashboard "Advanced services" section (service-name based).
  return getAdvancedServicesForDevice(device);
}

export function getDashboardLevelTriggers(device: UIDevice): DeviceTriggerSpec[] {
  // Triggers are limited to the dashboard-level concepts exposed in the tenant UI.
  return getTriggersForDevice(device, 'automation').filter((trigger) => {
    return (
      trigger.type === 'state_equals' ||
      trigger.type === 'attribute_delta' ||
      trigger.type === 'position_equals'
    );
  });
}

export function getEligibleDevicesForAutomations(devices: UIDevice[]) {
  return devices.filter((d) => {
    const areaName = (d.displayAreaName ?? d.areaName ?? d.area ?? '').trim();
    if (!areaName) return false;
    const cap = getCapabilitiesForDevice(d);
    if (!cap || cap.excludeFromAutomations) return false;
    const group = getGroupLabel(d);
    return group !== OTHER_LABEL && group !== REMOTE_LABEL;
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
  const keys = ['temperature', 'target_temperature', 'target_temp', 'target_temp_low', 'target_temp_high'] as const;
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function getCurrentTemperature(attrs: Record<string, unknown>) {
  // IMPORTANT: Do not include "temperature" here. In Home Assistant climate entities,
  // "temperature" is commonly the target setpoint, while "current_temperature" is the measured value.
  const keys = [
    'current_temperature',
    'current_temp',
    'current_temp_c',
    'measured_temperature',
    'ambient_temperature',
    'sensor_temperature',
    'temp',
  ] as const;
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}
