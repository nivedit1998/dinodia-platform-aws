'use client';

import { useEffect, useMemo, useState } from 'react';
import { UIDevice } from '@/types/device';
import { getPrimaryLabel } from '@/lib/deviceLabels';
import { DeviceControls } from './DeviceControls';
import {
  getDetailAccent,
  getDeviceArea,
  getDeviceSecondaryText,
  getVisualPreset,
} from './deviceVisuals';

type DeviceDetailSheetProps = {
  device: UIDevice;
  onClose: () => void;
  onActionComplete?: () => void;
  relatedDevices?: UIDevice[];
  showAdminControls?: boolean;
  onOpenAdminEdit?: () => void;
};

export function DeviceDetailSheet({
  device,
  onClose,
  onActionComplete,
  relatedDevices,
  showAdminControls = false,
  onOpenAdminEdit,
}: DeviceDetailSheetProps) {
  const label = getPrimaryLabel(device);
  const accent = getDetailAccent(label);
  const visual = getVisualPreset(label);
  const Icon = visual.icon;
  const secondary = useMemo(
    () => getDeviceSecondaryText(label, device),
    [label, device]
  );
  const area = useMemo(() => getDeviceArea(device), [device]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 py-6 transition ${
        visible ? 'bg-slate-900/40' : 'bg-slate-900/0'
      }`}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-4xl rounded-[32px] border border-white/30 bg-white/90 shadow-2xl backdrop-blur-2xl transition-all duration-300 ${
          visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
        }`}
      >
        <div
          className={`rounded-[32px] bg-gradient-to-br ${accent} p-6 sm:p-8`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 text-slate-900">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
                {label}
              </p>
              <h2 className="text-3xl font-semibold">{device.name}</h2>
              <p className="text-sm text-slate-600">{secondary}</p>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                Area
              </p>
              <p className="text-sm text-slate-700">{area}</p>
            </div>
            <div className="flex items-center gap-2">
              {showAdminControls && (
                <button
                  type="button"
                  aria-label="Edit device"
                  onClick={() => onOpenAdminEdit?.()}
                  className="rounded-full bg-white/80 px-3 py-2 text-lg text-slate-500 shadow"
                >
                  ⋯
                </button>
              )}
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded-full bg-white/80 p-2 text-slate-500 shadow"
              >
                ×
              </button>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-4 text-slate-700">
            <div className="rounded-3xl bg-white/70 p-4 shadow">
              <Icon className="h-10 w-10 text-slate-900" />
            </div>
            <div className="text-sm text-slate-600">
              Live controls for{' '}
              <span className="font-medium text-slate-900">{device.name}</span>
            </div>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <DeviceControls
            device={device}
            onActionComplete={onActionComplete}
            relatedDevices={relatedDevices}
          />
        </div>
      </div>
    </div>
  );
}
