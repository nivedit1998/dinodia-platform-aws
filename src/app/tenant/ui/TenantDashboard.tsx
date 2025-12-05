'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UIDevice } from '@/types/device';
import {
  getGroupLabel,
  sortLabels,
  normalizeLabel,
} from '@/lib/deviceLabels';
import { DeviceTile } from '@/components/device/DeviceTile';
import { DeviceDetailSheet } from '@/components/device/DeviceDetailSheet';
import { subscribeToRefresh } from '@/lib/refreshBus';

type Props = {
  username: string;
};

type ViewMode = 'home' | 'holiday';

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

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
  }).format(date);
}

export default function TenantDashboard(props: Props) {
  void props;
  const [devices, setDevices] = useState<UIDevice[]>([]);
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const previousDevicesRef = useRef<UIDevice[] | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [supportsHoliday, setSupportsHoliday] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const requestCounterRef = useRef(0);
  const latestRequestRef = useRef<{ mode: ViewMode; id: number } | null>(null);

  const loadDevices = useCallback(
    async (opts?: { silent?: boolean; modeOverride?: ViewMode }) => {
      const silent = opts?.silent ?? false;
      const mode = opts?.modeOverride ?? viewMode;
      const requestId = requestCounterRef.current + 1;
      requestCounterRef.current = requestId;
      latestRequestRef.current = { mode, id: requestId };
      let showSpinner = false;
      if (!previousDevicesRef.current && !silent) {
        setLoadingDevices(true);
        showSpinner = true;
      }
      if (!silent) {
        setError(null);
      }
      try {
        const url = mode === 'holiday' ? '/api/devices?view=holiday' : '/api/devices';
        const res = await fetch(url);
        const data = await res.json();
        const isLatest =
          latestRequestRef.current?.id === requestId && latestRequestRef.current?.mode === mode;
        if (!isLatest) return;

        if (showSpinner) setLoadingDevices(false);

        if (!res.ok) {
          previousDevicesRef.current = null;
          setDevices([]);
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
        const isLatest =
          latestRequestRef.current?.id === requestId && latestRequestRef.current?.mode === mode;
        if (!isLatest) return;
        if (showSpinner) setLoadingDevices(false);
        previousDevicesRef.current = null;
        setDevices([]);
        setError('Failed to load devices');
      }
    },
    [viewMode]
  );

  useEffect(() => {
    let mounted = true;
    async function loadConfig() {
      try {
        const res = await fetch('/api/tenant/dashboard-config');
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;

        const supports = Boolean(data.supportsHoliday);
        setSupportsHoliday(supports);

        let initialMode: ViewMode = 'home';
        if (typeof window !== 'undefined') {
          const stored = window.localStorage.getItem('dinodia_view_mode');
          if (stored === 'holiday' && supports) {
            initialMode = 'holiday';
          }
        }
        setViewMode(initialMode);
      } finally {
        if (mounted) setConfigLoading(false);
      }
    }
    void loadConfig();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (configLoading) return;
    void loadDevices();
  }, [loadDevices, configLoading]);

  useEffect(() => {
    const unsubscribe = subscribeToRefresh(() => {
      void loadDevices({ silent: true });
    });
    return unsubscribe;
  }, [loadDevices]);

  const handleModeChange = useCallback(
    (mode: ViewMode) => {
      if (mode === viewMode || configLoading) return;
      if (mode === 'holiday' && !supportsHoliday) return;
      setViewMode(mode);
      setDevices([]);
      previousDevicesRef.current = null;
      setError(null);
      setLoadingDevices(true);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('dinodia_view_mode', mode);
      }
      void loadDevices({ silent: false, modeOverride: mode });
    },
    [viewMode, loadDevices, supportsHoliday, configLoading]
  );

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 60000);
    return () => clearInterval(id);
  }, []);

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

  const openDevice = openDeviceId
    ? devices.find((d) => d.entityId === openDeviceId) ?? null
    : null;

  const relatedDevices =
    openDevice && getGroupLabel(openDevice) === 'Home Security'
      ? devices.filter((d) => getGroupLabel(d) === 'Home Security')
      : undefined;
  const holidayDisabled = !supportsHoliday || configLoading;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-10 lg:pt-14">
        <header className="sticky top-4 z-30 flex h-14 items-center justify-between rounded-full border border-white/60 bg-white/80 px-6 text-sm text-slate-600 shadow-sm backdrop-blur-xl">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
              Dinodia Home
            </p>
            <p className="text-lg font-semibold text-slate-900">
              Connected Devices
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Today
              </p>
              <p>{clock}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-slate-100 px-1 py-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => handleModeChange('home')}
                className={`px-2 py-1 rounded-full ${
                  viewMode === 'home'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                At home
              </button>
              <button
                type="button"
                onClick={() => supportsHoliday && handleModeChange('holiday')}
                disabled={holidayDisabled}
                className={`px-2 py-1 rounded-full ${
                  viewMode === 'holiday'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500'
                } ${holidayDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                Holiday
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-3xl border border-red-100 bg-red-50/80 px-6 py-4 text-sm text-red-600 shadow-sm">
            {error}
          </div>
        )}

        <div className="space-y-10">
          {sortedLabels.map((label) => {
            const group = labelGroups.get(label);
            if (!group || group.length === 0) return null;
            return (
              <section key={label} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {label}
                  </h2>
                  {loadingDevices && (
                    <span className="text-xs text-slate-400">
                      Refreshing…
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {group.map((device) => (
                    <DeviceTile
                      key={device.entityId}
                      device={device}
                      viewMode={viewMode}
                      onOpenDetails={() => setOpenDeviceId(device.entityId)}
                      onActionComplete={() => loadDevices({ silent: true })}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {sortedLabels.length === 0 && !loadingDevices && (
            <p className="rounded-3xl border border-slate-200/70 bg-white/70 px-6 py-10 text-center text-sm text-slate-500">
              No devices available. Ask your Dinodia admin to confirm your
              access.
            </p>
          )}
        </div>
      </div>

      {openDevice && (
        <DeviceDetailSheet
          device={openDevice}
          viewMode={viewMode}
          onClose={() => setOpenDeviceId(null)}
          onActionComplete={() => loadDevices({ silent: true })}
          relatedDevices={relatedDevices}
        />
      )}
    </div>
  );
}
