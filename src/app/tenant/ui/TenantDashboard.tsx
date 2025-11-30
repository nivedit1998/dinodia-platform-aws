'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UIDevice } from '@/types/device';
import {
  getGroupLabel,
  sortLabels,
  normalizeLabel,
} from '@/lib/deviceLabels';
import { DeviceControls } from '@/components/device/DeviceControls';

type Props = {
  username: string;
};

function devicesAreDifferent(a: UIDevice[], b: UIDevice[]) {
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
  const [devices, setDevices] = useState<UIDevice[]>([]);
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

      const list: UIDevice[] = data.devices || [];
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
          normalizeLabel(d.label).length > 0 ||
          labels.some((lbl) => normalizeLabel(lbl).length > 0);
        const primary = !isDetailDevice(d.state);
        return areaName.length > 0 && hasLabel && primary;
      }),
    [devices]
  );

  const labelGroups = useMemo(() => {
    const map = new Map<string, UIDevice[]>();
    visibleDevices.forEach((device) => {
      const key = getGroupLabel(device);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(device);
    });
    return map;
  }, [visibleDevices]);

  const sortedLabels = useMemo(
    () => sortLabels(Array.from(labelGroups.keys())),
    [labelGroups]
  );

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
                  <div
                    key={device.entityId}
                    className="min-w-[200px] border border-slate-200 rounded-xl p-4 text-xs shadow-sm flex-shrink-0"
                  >
                    <DeviceControls device={device} />
                  </div>
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
