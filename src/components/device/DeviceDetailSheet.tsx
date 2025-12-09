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
  linkedSensors?: UIDevice[];
};

export function DeviceDetailSheet({
  device,
  onClose,
  onActionComplete,
  relatedDevices,
  showAdminControls = false,
  onOpenAdminEdit,
  linkedSensors,
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
          {showAdminControls && Array.isArray(linkedSensors) && linkedSensors.length > 0 && (
            <div className="mt-8 space-y-4 rounded-3xl border border-slate-100 bg-white/70 p-4 shadow-sm sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    Sensors for this device
                  </p>
                  <p className="text-sm text-slate-600">
                    Live readouts from linked entities
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                  {linkedSensors.length} linked
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {linkedSensors.map((sensor) => (
                  <SensorCard key={sensor.entityId} sensor={sensor} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SensorCard({ sensor }: { sensor: UIDevice }) {
  const reading = formatSensorReading(sensor);
  const extras = getSensorAttributes(sensor);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.32em] text-slate-400">
            {sensor.label || sensor.labelCategory || 'Sensor'}
          </p>
          <p className="text-sm font-semibold text-slate-900">{sensor.name}</p>
          <p className="text-xs text-slate-500">{reading}</p>
        </div>
        <span className="rounded-xl bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          {formatState(sensor.state)}
        </span>
      </div>
      {extras.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
          {extras.map((attr) => (
            <span
              key={attr.label}
              className="rounded-full bg-slate-50 px-2 py-1 shadow-inner"
            >
              {attr.label}: {attr.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatState(state: string) {
  return state
    ? state
        .toString()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Unknown';
}

function formatSensorReading(sensor: UIDevice) {
  const attrs = sensor.attributes || {};
  const unit =
    typeof attrs.unit_of_measurement === 'string'
      ? attrs.unit_of_measurement
      : '';
  const stateText = formatState(sensor.state);
  return unit ? `${stateText} ${unit}` : stateText;
}

function formatAttributeValue(key: string, value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    const suffix =
      key.includes('battery') || key.includes('humidity') ? '%' : '';
    if (!Number.isFinite(value)) return '';
    return `${value}${suffix}`;
  }
  if (typeof value === 'string') return value;
  return '';
}

function getSensorAttributes(sensor: UIDevice) {
  const attrs = sensor.attributes || {};
  const keys: Record<string, string> = {
    temperature: 'Temp',
    humidity: 'Humidity',
    battery: 'Battery',
    battery_level: 'Battery',
    power: 'Power',
    voltage: 'Voltage',
    current: 'Current',
    illuminance: 'Light',
    pressure: 'Pressure',
  };
  const extras: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const [key, label] of Object.entries(keys)) {
    const value = attrs[key];
    const formatted = formatAttributeValue(key, value);
    if (formatted && !seen.has(label)) {
      extras.push({ label, value: formatted });
      seen.add(label);
    }
  }
  return extras;
}
