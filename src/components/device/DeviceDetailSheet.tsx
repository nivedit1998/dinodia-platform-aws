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
  allowSensorHistory?: boolean;
  historyEndpoint?: string;
  onOpenAdminEdit?: () => void;
  linkedSensors?: UIDevice[];
};

export function DeviceDetailSheet({
  device,
  onClose,
  onActionComplete,
  relatedDevices,
  showAdminControls = false,
  allowSensorHistory = true,
  historyEndpoint = '/api/admin/monitoring/history',
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
          {Array.isArray(linkedSensors) && linkedSensors.length > 0 && (
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
                  <SensorCard
                    key={sensor.entityId}
                    sensor={sensor}
                    allowSensorHistory={allowSensorHistory}
                    historyEndpoint={historyEndpoint}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type HistoryPoint = {
  bucketStart: string;
  label: string;
  value: number;
  count: number;
};

function SensorCard({
  sensor,
  allowSensorHistory = true,
  historyEndpoint = '/api/admin/monitoring/history',
}: {
  sensor: UIDevice;
  allowSensorHistory?: boolean;
  historyEndpoint?: string;
}) {
  const reading = formatSensorReading(sensor);
  const extras = getSensorAttributes(sensor);
  const [expanded, setExpanded] = useState(false);
  const [bucket, setBucket] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [historyUnit, setHistoryUnit] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (allowSensorHistory) return;
    setExpanded(false);
    setHistory(null);
    setHistoryUnit(null);
    setHistoryError(null);
  }, [allowSensorHistory]);

  useEffect(() => {
    if (!allowSensorHistory || !expanded) return;

    let aborted = false;
    const controller = new AbortController();

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError(null);
    try {
      const params = new URLSearchParams({
        entityId: sensor.entityId,
        bucket,
      });
      const res = await fetch(`${historyEndpoint}?${params.toString()}`, {
        signal: controller.signal,
      });
        const data = await res.json();
        if (aborted) return;
        if (!res.ok || !data.ok) {
          setHistoryError(data.error || 'Failed to load history');
          setHistory(null);
          setHistoryUnit(null);
          return;
        }
        setHistory(Array.isArray(data.points) ? data.points : []);
        setHistoryUnit(typeof data.unit === 'string' ? data.unit : null);
      } catch (err) {
        if (aborted) return;
        if ((err as Error).name === 'AbortError') return;
        console.error(err);
        setHistoryError('Failed to load history');
        setHistory(null);
        setHistoryUnit(null);
      } finally {
        if (!aborted) {
          setHistoryLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [allowSensorHistory, expanded, bucket, historyEndpoint, sensor.entityId]);

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
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-xl bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            {formatState(sensor.state)}
          </span>
          {allowSensorHistory && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="text-[11px] rounded-full bg-slate-100 px-2 py-1 text-slate-600 hover:bg-slate-200"
            >
              {expanded ? 'Hide history' : 'History'}
            </button>
          )}
        </div>
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
      {allowSensorHistory && expanded && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-600">
            <span className="uppercase tracking-[0.18em] text-slate-400">
              History
            </span>
            {(['daily', 'weekly', 'monthly'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setBucket(key)}
                className={[
                  'rounded-full px-2 py-1',
                  'border text-[11px]',
                  bucket === key
                    ? 'border-slate-500 bg-slate-600 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
                ].join(' ')}
              >
                {key === 'daily' ? 'Daily' : key === 'weekly' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
            {historyLoading && <p>Loading...</p>}
            {historyError && !historyLoading && (
              <p className="text-red-500">{historyError}</p>
            )}
            {!historyLoading && !historyError && history && history.length === 0 && (
              <p>No history yet.</p>
            )}
            {!historyLoading && !historyError && history && history.length > 0 && (
              <ul className="space-y-1">
                {history.map((point) => (
                  <li key={point.bucketStart} className="flex justify-between gap-2">
                    <span>{point.label}</span>
                    <span className="font-medium">
                      {point.value.toFixed(2)}
                      {historyUnit ? ` ${historyUnit}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
