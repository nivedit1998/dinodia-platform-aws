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
  getPrimaryLabel,
  OTHER_LABEL,
} from '@/lib/deviceLabels';
import { getDeviceGroupingId } from '@/lib/deviceIdentity';
import { isSensorEntity } from '@/lib/deviceSensors';
import Link from 'next/link';
import Image from 'next/image';
import { DeviceTile } from '@/components/device/DeviceTile';
import { DeviceDetailSheet } from '@/components/device/DeviceDetailSheet';
import { DeviceEditSheet } from '@/components/device/DeviceEditSheet';
import { subscribeToRefresh } from '@/lib/refreshBus';
import { logout as performLogout } from '@/lib/logout';
import { getTileEligibleDevicesForTenantDashboard } from '@/lib/deviceCapabilities';
import {
  buildBatteryPercentByDeviceGroup,
  getBatteryPercentForDevice,
} from '@/lib/deviceBattery';
import { platformFetch } from '@/lib/platformFetchClient';
import { useDevicesVersionPolling } from '@/lib/useDevicesVersionPolling';

type Props = {
  username: string;
};

type EditValues = Record<
  string,
  {
    name: string;
    area: string;
    label: string;
    blindTravelSeconds?: string;
  }
>;

const ALL_AREAS = 'All areas';
const REFRESH_THROTTLE_MS = 3000;

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
      prev.labelCategory !== d.labelCategory ||
      prev.deviceId !== d.deviceId
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [selectedArea, setSelectedArea] = useState<string>(() => {
    if (typeof window === 'undefined') return ALL_AREAS;
    try {
      return localStorage.getItem('adminSelectedArea') || ALL_AREAS;
    } catch {
      return ALL_AREAS;
    }
  });
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);
  const areaMenuRef = useRef<HTMLDivElement | null>(null);

  const resolveDeviceErrorMessage = useCallback(async (dataError?: string) => {
    const fallback =
      dataError ||
      'We couldn’t load your devices. Please check your connection and try again.';
    try {
      const remoteRes = await platformFetch('/api/alexa/devices', {
        cache: 'no-store',
        credentials: 'include',
      });
      const remoteData = await remoteRes.json().catch(() => ({}));
      if (remoteRes.ok && Array.isArray(remoteData.devices) && remoteData.devices.length === 0) {
        return 'We couldn’t reach your home yet. Finish setting up remote access using the Dinodia Kiosk on home Wi‑Fi so Dinodia can connect.';
      }
    } catch {
      // Ignore and fall back to the original message.
    }
    return fallback;
  }, []);

  const loadDevices = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      const silent = opts?.silent ?? false;
      const force = opts?.force ?? false;
      const now = Date.now();
      const lastLoaded = lastLoadedRef.current;
      if (!force && lastLoaded && now - lastLoaded < REFRESH_THROTTLE_MS) {
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
        const endpoint = force ? '/api/devices?fresh=1' : '/api/devices';
        const res = await platformFetch(endpoint, { signal: controller.signal });
        const data = await res.json();
        const isLatest = latestRequestRef.current === requestId;
        if (!isLatest) return;

        setLoading(false);
        abortControllerRef.current = null;

        if (!res.ok) {
          const friendly = await resolveDeviceErrorMessage(data.error);
          if (latestRequestRef.current !== requestId) return;
          setError(friendly);
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
                blindTravelSeconds:
                  d.blindTravelSeconds != null ? String(d.blindTravelSeconds) : '',
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
        const friendly = await resolveDeviceErrorMessage();
        if (latestRequestRef.current !== requestId) return;
        setError(friendly);
      }
    },
    [resolveDeviceErrorMessage]
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

  const handleVersionChange = useCallback(() => {
    void loadDevices({ silent: true, force: true });
  }, [loadDevices]);

  useDevicesVersionPolling({
    onVersionChange: handleVersionChange,
  });

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

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!areaMenuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (
        areaMenuRef.current &&
        !areaMenuRef.current.contains(event.target as Node)
      ) {
        setAreaMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setAreaMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [areaMenuOpen]);

  const isLoading = loading;
  const currentError = error;
  const hasDevices = devices.length > 0;

  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    const eligible = getTileEligibleDevicesForTenantDashboard(devices);
    for (const d of eligible) {
      const areaName = (d.area ?? d.areaName ?? '').trim();
      if (areaName) set.add(areaName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [devices]);

  const resolvedSelectedArea = useMemo(() => {
    if (selectedArea === ALL_AREAS) return ALL_AREAS;
    return areaOptions.includes(selectedArea) ? selectedArea : ALL_AREAS;
  }, [areaOptions, selectedArea]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('adminSelectedArea', resolvedSelectedArea);
    } catch (err) {
      console.warn('Unable to persist admin area', err);
    }
  }, [resolvedSelectedArea]);

  const eligibleDevices = useMemo(
    () => getTileEligibleDevicesForTenantDashboard(devices),
    [devices]
  );

  const batteryByGroup = useMemo(
    () => buildBatteryPercentByDeviceGroup(devices),
    [devices]
  );

  const visibleDevices = useMemo(
    () =>
      eligibleDevices.filter((d) => {
        const areaName = (d.area ?? d.areaName ?? '').trim();
        if (
          resolvedSelectedArea !== ALL_AREAS &&
          areaName !== resolvedSelectedArea
        ) {
          return false;
        }
        return true;
      }),
    [eligibleDevices, resolvedSelectedArea]
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

    let blindTravelSeconds: number | null = null;
    const rawTravel = current.blindTravelSeconds ?? '';
    if (rawTravel.trim() !== '') {
      const parsed = Number(rawTravel);
      if (Number.isFinite(parsed) && parsed > 0) {
        blindTravelSeconds = parsed;
      } else {
        setMessage('Blind travel time must be a positive number of seconds.');
        setSavingDeviceId(null);
        return;
      }
    }

    const res = await platformFetch('/api/admin/device', {
      method: 'POST',
      body: JSON.stringify({
        entityId,
        name: current.name,
        area: current.area,
        label: current.label,
        blindTravelSeconds,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(
        data.error || 'We couldn’t save that device. Please check the details and try again.'
      );
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

  const linkedSensors = useMemo(() => {
    if (!openDevice) return [];
    const targetGroupId = getDeviceGroupingId(openDevice);
    if (!targetGroupId) return [];
    return devices.filter(
      (candidate) =>
        candidate.entityId !== openDevice.entityId &&
        getDeviceGroupingId(candidate) === targetGroupId &&
        isSensorEntity(candidate)
    );
  }, [devices, openDevice]);
  const kwhSensorsByEntityId = useMemo(() => {
    const map = new Map<string, string>();
    devices.forEach((device) => {
      if (isSensorEntity(device)) return;
      const groupId = getDeviceGroupingId(device);
      if (!groupId) return;
      const sensor = devices.find(
        (d) =>
          d.entityId !== device.entityId &&
          getDeviceGroupingId(d) === groupId &&
          isSensorEntity(d) &&
          typeof d.attributes?.unit_of_measurement === 'string' &&
          d.attributes.unit_of_measurement === 'kWh'
      );
      if (sensor) {
        map.set(device.entityId, sensor.entityId);
      }
    });
    return map;
  }, [devices]);
  const [kwhTotals, setKwhTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    const sensorIds = Array.from(new Set(Array.from(kwhSensorsByEntityId.values())));
    if (sensorIds.length === 0) {
      setKwhTotals({});
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/admin/monitoring/kwh-totals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityIds: sensorIds }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok || !Array.isArray(data.totals)) {
          throw new Error(data?.error || 'Failed to load energy totals');
        }
        const map: Record<string, number> = {};
        for (const row of data.totals) {
          if (!row || typeof row.entityId !== 'string') continue;
          if (typeof row.totalKwh === 'number' && Number.isFinite(row.totalKwh)) {
            map[row.entityId] = row.totalKwh;
          }
        }
        setKwhTotals(map);
      } catch (err) {
        console.warn('Failed to fetch kWh totals', err);
        setKwhTotals({});
      }
    })();
  }, [kwhSensorsByEntityId]);

  const relatedDevices =
    openDevice && getGroupLabel(openDevice) === 'Home Security'
      ? devices.filter((d) => getGroupLabel(d) === 'Home Security')
      : undefined;

  const editingDevice = editingDeviceId
    ? devices.find((d) => d.entityId === editingDeviceId) ?? null
    : null;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-3 pb-16 pt-8 sm:px-4 lg:pt-12">
        <header className="sticky top-4 z-30 flex flex-col gap-3 rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:rounded-full sm:px-6 sm:py-2.5">
          <div className="flex items-start gap-3 sm:items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/60 bg-white shadow-sm">
              <Image
                src="/brand/logo-mark.png"
                alt="Dinodia"
                width={40}
                height={40}
                priority
              />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
                Homeowner dashboard
              </p>
              <div className="relative inline-block" ref={areaMenuRef}>
                <button
                  type="button"
                  onClick={() => setAreaMenuOpen((open) => !open)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-white"
                >
                  <span>
                    {resolvedSelectedArea === ALL_AREAS
                      ? 'Building controls'
                      : resolvedSelectedArea}
                  </span>
                  <span className="text-xs text-slate-500">▾</span>
                </button>
                {areaMenuOpen && (
                  <div className="absolute left-0 z-10 mt-2 w-56 rounded-xl border border-slate-100 bg-white/95 p-1 text-sm text-slate-700 shadow-lg backdrop-blur">
                    <button
                      type="button"
                      className="flex w-full items-center rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => {
                        setSelectedArea(ALL_AREAS);
                        setAreaMenuOpen(false);
                      }}
                    >
                      All areas
                    </button>
                    {areaOptions.map((area) => (
                      <button
                        key={area}
                        type="button"
                        className="flex w-full items-center rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => {
                          setSelectedArea(area);
                          setAreaMenuOpen(false);
                        }}
                      >
                        {area}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-right min-w-[120px]">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Today
              </p>
              <p>{clock}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center text-slate-400">
                {isLoading && (
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500"
                    role="status"
                    aria-label="Refreshing devices"
                  />
                )}
              </div>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  aria-label="Menu"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 shadow-sm hover:bg-white"
                >
                  <span className="sr-only">Menu</span>
                  <span className="flex flex-col gap-1">
                    <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
                    <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
                    <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
                  </span>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-100 bg-white/95 p-1 text-sm text-slate-700 shadow-lg backdrop-blur">
                    <Link
                      href="/admin/settings"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Homeowner Settings
                    </Link>
                    <Link
                      href="/devices/manage"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Manage Devices
                    </Link>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => {
                        setMenuOpen(false);
                        void performLogout();
                      }}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
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
            if (label === OTHER_LABEL) return null; // skip "Other" in admin
            const group = labelGroups.get(label);
            if (!group || group.length === 0) return null;
            return (
              <section key={label} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold tracking-tight">
                    {label}
                  </h2>
                </div>
                <div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    {group.map((device) => (
                      <DeviceTile
                        key={device.entityId}
                        device={device}
                        batteryPercent={getBatteryPercentForDevice(device, batteryByGroup)}
                        onOpenDetails={() => setOpenDeviceId(device.entityId)}
                        onActionComplete={() => loadDevices({ silent: true, force: true })}
                        showAdminControls
                        onOpenAdminEdit={() => setEditingDeviceId(device.entityId)}
                        allowDeviceControl={false}
                        showControlButton={false}
                        kwhTotal={
                          kwhSensorsByEntityId.has(device.entityId)
                            ? kwhTotals[kwhSensorsByEntityId.get(device.entityId)!] ?? null
                            : null
                        }
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
          linkedSensors={linkedSensors}
          allowSensorHistory
          onOpenAdminEdit={() => setEditingDeviceId(openDevice.entityId)}
          allowDeviceControl={false}
          showControlsSection={false}
          showStateText={false}
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
              blindTravelSeconds:
                editingDevice.blindTravelSeconds != null
                  ? String(editingDevice.blindTravelSeconds)
                  : '',
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
                  blindTravelSeconds:
                    editingDevice.blindTravelSeconds != null
                      ? String(editingDevice.blindTravelSeconds)
                      : '',
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
