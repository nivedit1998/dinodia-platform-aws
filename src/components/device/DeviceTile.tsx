'use client';

import { useMemo } from 'react';
import { UIDevice } from '@/types/device';
import { getPrimaryLabel } from '@/lib/deviceLabels';
import {
  DeviceActionSpec,
  DeviceCommandId,
  getActionsForDevice,
  getBlindPosition,
} from '@/lib/deviceCapabilities';
import {
  getDeviceArea,
  getDeviceSecondaryText,
  getVisualPreset,
  isDeviceActive,
  tileSizeClasses,
} from './deviceVisuals';
import { useDeviceCommand } from './DeviceControls';

type DeviceTileProps = {
  device: UIDevice;
  batteryPercent?: number | null;
  onOpenDetails: () => void;
  onActionComplete?: () => void;
  onOpenAdminEdit?: () => void;
  showAdminControls?: boolean;
  showControlButton?: boolean;
  allowDeviceControl?: boolean;
};

export function DeviceTile({
  device,
  batteryPercent = null,
  onOpenDetails,
  onActionComplete,
  onOpenAdminEdit,
  showAdminControls = false,
  showControlButton = true,
  allowDeviceControl = true,
}: DeviceTileProps) {
  const label = getPrimaryLabel(device);
  const actions = useMemo(() => getActionsForDevice(device, 'dashboard'), [device]);
  const visual = getVisualPreset(label);
  const isActive = isDeviceActive(label, device);
  const secondary = getDeviceSecondaryText(label, device);
  const area = getDeviceArea(device);
  const { pendingCommand, sendCommand } = useDeviceCommand(
    onActionComplete,
    allowDeviceControl
  );
  const primaryAction = getPrimaryAction(label, device, actions);
  const batteryDisplay = batteryPercent != null ? formatBatteryForTile(batteryPercent) : null;

  const baseClasses =
    'relative w-full max-w-[360px] sm:max-w-none rounded-[26px] p-4 sm:p-6 shadow-[0_20px_40px_rgba(15,23,42,0.08)] transition duration-300 cursor-pointer select-none';
  const bgClass = isActive ? visual.activeBg : visual.inactiveBg;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          onOpenDetails();
        }
      }}
      className={`${baseClasses} ${bgClass} ${tileSizeClasses(visual.size)} ${
        isActive ? 'ring-1 ring-white/40' : 'ring-1 ring-white/60'
      }`}
    >
      {showAdminControls && (
        <button
          type="button"
          aria-label="Edit device"
          onClick={(event) => {
            event.stopPropagation();
            onOpenAdminEdit?.();
          }}
          className="absolute right-4 top-4 rounded-full bg-white/70 px-3 py-1 text-lg text-slate-500 shadow"
        >
          ⋯
        </button>
      )}
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="space-y-2 pr-5">
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-500">
            {label}
          </p>
          <p className="text-lg font-semibold text-slate-900">{device.name}</p>
          <p className="text-sm text-slate-500">{secondary}</p>
          {batteryDisplay && (
            <p
              className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${batteryDisplay.className}`}
            >
              {batteryDisplay.text}
            </p>
          )}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
            <p className="text-[10px]">Area</p>
            <p className="mt-1 text-sm font-medium normal-case tracking-normal text-slate-600">
              {area}
            </p>
          </div>
          {showControlButton && primaryAction ? (
            <button
              type="button"
              className={`relative flex h-14 w-14 items-center justify-center rounded-2xl text-2xl shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 sm:h-16 sm:w-16 ${
                isActive ? visual.iconActiveBg : visual.iconInactiveBg
              } ${primaryAction ? 'cursor-pointer' : 'cursor-default'}`}
              onClick={(event) => {
                event.stopPropagation();
                if (!primaryAction || !allowDeviceControl) {
                  onOpenDetails();
                  return;
                }
                void sendCommand({
                  entityId: device.entityId,
                  command: primaryAction.command,
                  value: primaryAction.value,
                });
              }}
              disabled={pendingCommand !== null || !primaryAction || !allowDeviceControl}
            >
              {pendingCommand ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
              ) : (
                <visual.icon className="h-7 w-7 text-inherit" />
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type PrimaryAction = { command: DeviceCommandId; value?: number } | null;

function getPrimaryAction(
  label: string,
  device: UIDevice,
  actions: DeviceActionSpec[]
): PrimaryAction {
  const powerOn = actions.find(
    (action) => action.kind === 'command' && action.id.endsWith('/turn_on')
  )?.id as DeviceCommandId | undefined;
  const powerOff = actions.find(
    (action) => action.kind === 'command' && action.id.endsWith('/turn_off')
  )?.id as DeviceCommandId | undefined;

  switch (label) {
    case 'Light': {
      if (powerOn && powerOff) {
        const isOn = device.state.toLowerCase() === 'on';
        return { command: isOn ? powerOff : powerOn };
      }
      break;
    }
    case 'Blind': {
      const sliderAction = actions.find(
        (action) => action.kind === 'slider' && action.id === 'blind/set_position'
      );
      const fixedAction = actions.find(
        (action) => action.kind === 'fixed-position' && action.id === 'blind/set_position'
      ) as Extract<DeviceActionSpec, { kind: 'fixed-position' }> | undefined;
      const position = getBlindPosition(device.attributes ?? {});
      const normalized = device.state.toLowerCase();
      const isOpen =
        position !== null
          ? position > 0
          : normalized === 'open' || normalized === 'opening' || normalized === 'on';
      if (sliderAction) {
        return {
          command: sliderAction.id,
          value: isOpen ? 0 : 100,
        };
      }
      if (fixedAction) {
        const target = isOpen
          ? fixedAction.positions.find((p) => p.value === 0)
          : fixedAction.positions.find((p) => p.value === 100);
        if (target) {
          return { command: fixedAction.id, value: target.value };
        }
      }
      break;
    }
    case 'Spotify': {
      const playPause = actions.find(
        (action) => action.kind === 'command' && action.id === 'media/play_pause'
      );
      if (playPause) return { command: playPause.id };
      break;
    }
    case 'TV':
    case 'Speaker': {
      if (powerOn && powerOff) {
        const isOn = device.state.toLowerCase() !== 'off' && device.state.toLowerCase() !== 'standby';
        return { command: isOn ? powerOff : powerOn };
      }
      break;
    }
    default:
      break;
  }
  return null;
}

function formatBatteryForTile(percent: number) {
  if (!Number.isFinite(percent)) return null;
  const rounded = Math.round(percent);
  if (rounded <= 0) {
    return {
      text: `Battery ${rounded}% • Change Batteries !`,
      className: 'bg-rose-100/90 text-rose-700',
    };
  }
  if (rounded < 20) {
    return {
      text: `Battery ${rounded}% • Low Battery !`,
      className: 'bg-amber-100/90 text-amber-800',
    };
  }
  return {
    text: `Battery ${rounded}%`,
    className: 'bg-slate-100/80 text-slate-600',
  };
}
