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
  getPrimaryLabel,
} from '@/lib/deviceLabels';
import { DeviceTile } from '@/components/device/DeviceTile';
import { DeviceDetailSheet } from '@/components/device/DeviceDetailSheet';
import { DeviceEditSheet } from '@/components/device/DeviceEditSheet';
import { subscribeToRefresh } from '@/lib/refreshBus';

type Props = {
  username: string;
};

type EditValues = Record<
  string,
  {
    name: string;
    area: string;
    label: string;
  }
>;

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

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'short',
  }).format(date);
}

export default function AdminDashboard(props: Props) {
  void props;
  const [devices, setDevices] = useState<UIDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const editingDeviceIdRef = useRef<string | null>(null);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({});
  const requestCounterRef = useRef(0);
  const latestRequestRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const lastLoadedRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadDevices = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      const silent = opts?.silent ?? false;
      const force = opts?.force ?? false;
      const now = Date.now();
      const lastLoaded = lastLoadedRef.current;
      if (!force && lastLoaded && now - lastLoaded < 60_000) {
        setLoading(false);
        return;
      }

      const requestId = requestCounterRef.current + 1;
      requestCounterRef.current = requestId;
      latestRequestRef.current = requestId;

      if (!silent) {
        setError(null);
        setMessage(null);
      }
      setLoading(true);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch('/api/devices', { signal: controller.signal });
        const data = await res.json();
        const isLatest = latestRequestRef.current === requestId;
        if (!isLatest) return;

        setLoading(false);
        abortControllerRef.current = null;

        if (!res.ok) {
          setError(data.error || 'Failed to load devices');
          return;
        }

        const list: UIDevice[] = data.devices || [];
        let shouldUpdateEdits = false;
        setDevices((prev) => {
          if (!devicesAreDifferent(prev, list)) return prev;
          shouldUpdateEdits = true;
          return list;
        });
        if (shouldUpdateEdits) {
          setEditValues((prev) => {
            const next = { ...prev };
            for (const d of list) {
              if (editingDeviceIdRef.current === d.entityId) continue;
              next[d.entityId] = {
                name: d.name,
                area: d.area ?? d.areaName ?? '',
                label: d.label || getPrimaryLabel(d),
              };
            }
            return next;
          });
        }
        lastLoadedRef.current = Date.now();
      } catch (err) {
        const isLatest = latestRequestRef.current === requestId;
        if (!isLatest) return;
        if ((err as Error).name === 'AbortError') {
          setLoading(false);
          abortControllerRef.current = null;
          return;
        }
        console.error(err);
        setLoading(false);
        abortControllerRef.current = null;
        setError('Failed to load devices');
      }
    },
    []
  );

  useEffect(() => {
    editingDeviceIdRef.current = editingDeviceId;
  }, [editingDeviceId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadDevices();
    });
    return () => cancelAnimationFrame(frame);
  }, [loadDevices]);

  useEffect(() => {
    const unsubscribe = subscribeToRefresh(() => {
      void loadDevices({ silent: true });
    });
    return unsubscribe;
  }, [loadDevices]);

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    []
  );

  const isLoading = loading;
  const currentError = error;
  const hasDevices = devices.length > 0;

  const visibleDevices = useMemo(
    () =>
      devices.filter((d) => {
        const areaName = (d.area ?? d.areaName ?? '').trim();
        const labels = Array.isArray(d.labels) ? d.labels : [];
        const hasLabel =
          normalizeLabel(d.label).length > 0 ||
          labels.some((lbl) => normalizeLabel(lbl).length > 0);
        return areaName.length > 0 && hasLabel;
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

  async function saveDevice(entityId: string) {
    const current = editValues[entityId];
    if (!current) return;

    setSavingDeviceId(entityId);
    setMessage(null);

    const res = await fetch('/api/admin/device', {
      method: 'POST',
      body: JSON.stringify({
        entityId,
        name: current.name,
        area: current.area,
        label: current.label,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to save device');
    } else {
      setMessage('Device settings saved');
      setEditingDeviceId(null);
      void loadDevices({ silent: true, force: true });
    }
    setSavingDeviceId(null);
  }

  const openDevice = openDeviceId
    ? devices.find((d) => d.entityId === openDeviceId) ?? null
    : null;

  const relatedDevices =
    openDevice && getGroupLabel(openDevice) === 'Home Security'
      ? devices.filter((d) => getGroupLabel(d) === 'Home Security')
      : undefined;

  const editingDevice = editingDeviceId
    ? devices.find((d) => d.entityId === editingDeviceId) ?? null
    : null;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 pt-10 lg:pt-14">
        <header className="sticky top-4 z-30 flex h-14 items-center justify-between rounded-full border border-white/60 bg-white/80 px-6 text-sm text-slate-600 shadow-sm backdrop-blur-xl">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
              Dinodia Admin
            </p>
            <p className="text-lg font-semibold text-slate-900">
              Building controls
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Today
              </p>
              <p>{clock}</p>
            </div>
            {isLoading && (
              <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                Refreshing…
              </span>
            )}
          </div>
        </header>

        {currentError && !hasDevices && (
          <div className="rounded-3xl border border-red-100 bg-red-50/80 px-6 py-4 text-sm text-red-600 shadow-sm">
            {currentError}
          </div>
        )}
        {currentError && hasDevices && (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-amber-700 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span>{currentError}</span>
          </div>
        )}
        {message && (
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50/80 px-6 py-4 text-sm text-emerald-700 shadow-sm">
            {message}
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
                  {isLoading && (
                    <span className="text-xs text-slate-400">
                      Refreshing…
                    </span>
                  )}
                </div>
                <div className="relative">
                  {isLoading && (
                    <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/70 via-white/30 to-white/0 backdrop-blur-sm animate-pulse" />
                  )}
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                    {group.map((device) => (
                      <DeviceTile
                        key={device.entityId}
                        device={device}
                        onOpenDetails={() => setOpenDeviceId(device.entityId)}
                        onActionComplete={() => loadDevices({ silent: true, force: true })}
                        showAdminControls
                        onOpenAdminEdit={() => setEditingDeviceId(device.entityId)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}

          {sortedLabels.length === 0 && !isLoading && (
            <p className="rounded-3xl border border-slate-200/70 bg-white/70 px-6 py-10 text-center text-sm text-slate-500">
              No devices with both area and label were found. Confirm your Home
              Assistant labels and areas.
            </p>
          )}
        </div>
      </div>

      {openDevice && (
        <DeviceDetailSheet
          device={openDevice}
          onClose={() => setOpenDeviceId(null)}
          onActionComplete={() => loadDevices({ silent: true, force: true })}
          relatedDevices={relatedDevices}
          showAdminControls
          onOpenAdminEdit={() => setEditingDeviceId(openDevice.entityId)}
        />
      )}

      {editingDevice && (
        <DeviceEditSheet
          device={editingDevice}
          values={
            editValues[editingDevice.entityId] || {
              name: editingDevice.name,
              area: editingDevice.area ?? editingDevice.areaName ?? '',
              label:
                editingDevice.label || getPrimaryLabel(editingDevice) || '',
            }
          }
          onChange={(key, value) =>
            setEditValues((prev) => ({
              ...prev,
              [editingDevice.entityId]: {
                ...(prev[editingDevice.entityId] || {
                  name: editingDevice.name,
                  area: editingDevice.area ?? editingDevice.areaName ?? '',
                  label:
                    editingDevice.label || getPrimaryLabel(editingDevice) || '',
                }),
                [key]: value,
              },
            }))
          }
          onSave={() => saveDevice(editingDevice.entityId)}
          onClose={() => setEditingDeviceId(null)}
          saving={savingDeviceId === editingDevice.entityId}
        />
      )}
    </div>
  );
}
