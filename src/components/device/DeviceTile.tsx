'use client';

import { UIDevice } from '@/types/device';
import { getPrimaryLabel } from '@/lib/deviceLabels';
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
  onOpenDetails: () => void;
  onActionComplete?: () => void;
  onOpenAdminEdit?: () => void;
  showAdminControls?: boolean;
};

export function DeviceTile({
  device,
  onOpenDetails,
  onActionComplete,
  onOpenAdminEdit,
  showAdminControls = false,
}: DeviceTileProps) {
  const label = getPrimaryLabel(device);
  const visual = getVisualPreset(label);
  const isActive = isDeviceActive(label, device);
  const secondary = getDeviceSecondaryText(label, device);
  const area = getDeviceArea(device);
  const { pendingCommand, sendCommand } = useDeviceCommand(onActionComplete);
  const primaryAction = getPrimaryAction(label, device);

  const baseClasses =
    'relative rounded-[26px] p-5 sm:p-6 shadow-[0_20px_40px_rgba(15,23,42,0.08)] transition duration-300 cursor-pointer select-none';
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
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
            <p className="text-[10px]">Area</p>
            <p className="mt-1 text-sm font-medium normal-case tracking-normal text-slate-600">
              {area}
            </p>
          </div>
          <button
            type="button"
            className={`relative flex h-16 w-16 items-center justify-center rounded-2xl text-2xl shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${
              isActive ? visual.iconActiveBg : visual.iconInactiveBg
            } ${primaryAction ? 'cursor-pointer' : 'cursor-default'}`}
            onClick={(event) => {
              event.stopPropagation();
              if (!primaryAction) {
                onOpenDetails();
                return;
              }
              void sendCommand({
                entityId: device.entityId,
                command: primaryAction.command,
                value: primaryAction.value,
              });
            }}
            disabled={pendingCommand !== null || !primaryAction}
          >
            {pendingCommand ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
            ) : (
              <visual.icon className="h-7 w-7 text-inherit" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

type PrimaryAction = { command: string; value?: number } | null;

function getPrimaryAction(label: string, device: UIDevice): PrimaryAction {
  switch (label) {
    case 'Light':
      return { command: 'light/toggle' };
    case 'Blind': {
      const normalized = device.state.toLowerCase();
      const isOpen =
        normalized === 'open' ||
        normalized === 'opening' ||
        normalized === 'on';
      return { command: isOpen ? 'blind/close' : 'blind/open' };
    }
    case 'Spotify':
      return { command: 'media/play_pause' };
    case 'TV':
      return { command: 'tv/toggle_power' };
    case 'Speaker':
      return { command: 'speaker/toggle_power' };
    default:
      return null;
  }
}
