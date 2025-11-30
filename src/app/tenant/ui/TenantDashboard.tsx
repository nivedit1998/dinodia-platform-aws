'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Device = {
  entityId: string;
  name: string;
  state: string;
  area: string | null;
  areaName?: string | null;
  label: string | null;
  labelCategory?: string | null;
  labels?: string[];
};

type Props = {
  username: string;
};

const LABEL_ORDER = [
  'Light',
  'Blind',
  'Motion Sensor',
  'Spotify',
  'Boiler',
  'Doorbell',
  'Home Security',
  'TV',
  'Speaker',
] as const;
const OTHER_LABEL = 'Other';
const LABEL_ORDER_LOWER = LABEL_ORDER.map((label) => label.toLowerCase());

function normalizeDisplayLabel(label?: string | null) {
  return label?.toString().trim() ?? '';
}

function getPrimaryLabel(device: Device) {
  const overrideLabel = normalizeDisplayLabel(device.label);
  if (overrideLabel) return overrideLabel;
  const first =
    Array.isArray(device.labels) && device.labels.length > 0
      ? normalizeDisplayLabel(device.labels[0])
      : '';
  if (first) return first;
  return normalizeDisplayLabel(device.labelCategory) || OTHER_LABEL;
}

function getGroupKey(device: Device) {
  const label = getPrimaryLabel(device);
  const idx = LABEL_ORDER_LOWER.indexOf(label.toLowerCase());
  return idx >= 0 ? LABEL_ORDER[idx] : OTHER_LABEL;
}

function devicesAreDifferent(a: Device[], b: Device[]) {
  if (a.length !== b.length) return true;
  const mapA = new Map(a.map((d) => [d.entityId, d]));
  for (const d of b) {
    const prev = mapA.get(d.entityId);
    if (!prev) return true;
    if (
      prev.state !== d.state ||
      prev.name !== d.name ||
      (prev.area ?? prev.areaName) !== (d.area ?? d.areaName) ||
      prev.label !== d.label ||
      prev.labelCategory !== d.labelCategory
    ) {
      return true;
    }
  }
  return false;
}

function isDetailDevice(state: string) {
  const trimmed = (state ?? '').toString().trim();
  if (!trimmed) return false;
  const isUnavailable = trimmed.toLowerCase() === 'unavailable';
  const isNumeric = !Number.isNaN(Number(trimmed));
  return isUnavailable || isNumeric;
}

export default function TenantDashboard({ username }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousDevicesRef = useRef<Device[] | null>(null);

  const loadDevices = useCallback(async () => {
    let showSpinner = false;
    if (!previousDevicesRef.current) {
      setLoadingDevices(true);
      showSpinner = true;
    }
    setError(null);
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      if (showSpinner) setLoadingDevices(false);

      if (!res.ok) {
        setError(data.error || 'Failed to load devices');
        return;
      }

      const list: Device[] = data.devices || [];
      const previous = previousDevicesRef.current;
      if (!previous || devicesAreDifferent(previous, list)) {
        previousDevicesRef.current = list;
        setDevices(list);
      }
    } catch (err) {
      console.error(err);
      if (showSpinner) setLoadingDevices(false);
      setError('Failed to load devices');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDevices();
    const id = setInterval(loadDevices, 3000);
    return () => clearInterval(id);
  }, [loadDevices]);

  async function logout() {
    await fetch('/api/auth/login', { method: 'DELETE' });
    window.location.href = '/login';
  }

  const visibleDevices = useMemo(
    () =>
      devices.filter((d) => {
        const areaName = (d.area ?? d.areaName ?? '').trim();
        const labels = Array.isArray(d.labels) ? d.labels : [];
        const hasLabel =
          normalizeDisplayLabel(d.label).length > 0 ||
          labels.some((lbl) => normalizeDisplayLabel(lbl).length > 0);
        const primary = !isDetailDevice(d.state);
        return areaName.length > 0 && hasLabel && primary;
      }),
    [devices]
  );

  const labelGroups = useMemo(() => {
    const map = new Map<string, Device[]>();
    visibleDevices.forEach((device) => {
      const key = getGroupKey(device);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(device);
    });
    return map;
  }, [visibleDevices]);

  const sortedLabels = useMemo(() => {
    const keys = Array.from(labelGroups.keys());
    return keys.sort((a, b) => {
      const idxA = LABEL_ORDER_LOWER.indexOf(a.toLowerCase());
      const idxB = LABEL_ORDER_LOWER.indexOf(b.toLowerCase());
      const normA = idxA === -1 ? LABEL_ORDER.length : idxA;
      const normB = idxB === -1 ? LABEL_ORDER.length : idxB;
      if (normA !== normB) return normA - normB;
      return a.localeCompare(b);
    });
  }, [labelGroups]);

  return (
    <div className="w-full bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b pb-3">
        <div>
          <h1 className="text-2xl font-semibold">Dinodia Dashboard</h1>
          <p className="text-xs text-slate-500">
            Logged in as <span className="font-medium">{username}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDevices}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            Scan for devices
          </button>
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      </header>

  {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6">
        {sortedLabels.map((label) => {
          const group = labelGroups.get(label);
          if (!group) return null;
          return (
            <section key={label} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                  {label}
                </h2>
                {loadingDevices && (
                  <span className="text-[11px] text-slate-400">
                    Refreshing…
                  </span>
                )}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {group.map((device) => (
                  <DeviceTile key={device.entityId} device={device} />
                ))}
              </div>
            </section>
          );
        })}

        {sortedLabels.length === 0 && !loadingDevices && (
          <p className="text-sm text-slate-500">
            No devices available. Ask your Dinodia admin to confirm your access.
          </p>
        )}
      </div>
    </div>
  );
}

function DeviceTile({ device }: { device: Device }) {
  const badgeLabel = getPrimaryLabel(device);
  const areaDisplay = (device.area ?? device.areaName ?? '').trim();

  return (
    <div className="min-w-[200px] border border-slate-200 rounded-xl p-4 text-xs shadow-sm flex-shrink-0">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">
          {device.name}
        </p>
        {badgeLabel && (
          <span className="text-[10px] uppercase tracking-wide text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">
            {badgeLabel}
          </span>
        )}
      </div>
      <div className="mt-3 text-[11px]">
        State:{' '}
        <span className="font-semibold text-slate-800">{device.state}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Area:{' '}
        <span className="font-medium text-slate-600">
          {areaDisplay || '—'}
        </span>
      </div>
    </div>
  );
}
