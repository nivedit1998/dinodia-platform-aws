'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { UIDevice } from '@/types/device';
import {
  getGroupLabel,
  sortLabels,
  OTHER_LABEL,
} from '@/lib/deviceLabels';
import { isSensorEntity } from '@/lib/deviceSensors';
import { getDeviceGroupingId } from '@/lib/deviceIdentity';
import { DeviceTile } from '@/components/device/DeviceTile';
import { DeviceDetailSheet } from '@/components/device/DeviceDetailSheet';
import { subscribeToRefresh } from '@/lib/refreshBus';
import { logout as performLogout } from '@/lib/logout';
import Image from 'next/image';
import { getTileEligibleDevicesForTenantDashboard } from '@/lib/deviceCapabilities';
import {
  buildBatteryPercentByDeviceGroup,
  getBatteryPercentForDevice,
} from '@/lib/deviceBattery';
import { useDevicesVersionPolling } from '@/lib/useDevicesVersionPolling';

type Props = {
  username: string;
};

const ALL_AREAS = 'All areas';
const REFRESH_THROTTLE_MS = 3000;
const ALEXA_SKILL_URL = 'https://www.amazon.co.uk/gp/product/B0GGCC4BDS?nodl=0';

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

export default function TenantDashboard(props: Props) {
  void props;
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [devices, setDevices] = useState<UIDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestCounterRef = useRef(0);
  const latestRequestRef = useRef(0);
  const lastLoadedRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const deviceMenuRef = useRef<HTMLDivElement | null>(null);
  const [selectedArea, setSelectedArea] = useState<string>(() => {
    if (typeof window === 'undefined') return ALL_AREAS;
    try {
      return localStorage.getItem('tenantSelectedArea') || ALL_AREAS;
    } catch {
      return ALL_AREAS;
    }
  });
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);
  const areaMenuRef = useRef<HTMLDivElement | null>(null);
  const [showAlexaLink, setShowAlexaLink] = useState(false);

  const resolveDeviceErrorMessage = useCallback(async (dataError?: string) => {
    return (
      dataError ||
      'We couldn’t load your devices. Please check your connection and try again.'
    );
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
      }
      setLoading(true);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const endpoint = force ? '/api/devices?fresh=1' : '/api/devices';
        const res = await fetch(endpoint, { signal: controller.signal });
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
        setDevices((prev) => {
          if (!devicesAreDifferent(prev, list)) return prev;
          return list;
        });
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
    if (!menuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setDeviceMenuOpen(false);
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
        setDeviceMenuOpen(false);
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

  useEffect(() => {
    if (!deviceMenuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (deviceMenuRef.current && !deviceMenuRef.current.contains(event.target as Node)) {
        setDeviceMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDeviceMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [deviceMenuOpen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadDevices();
    });
    return () => cancelAnimationFrame(frame);
  }, [loadDevices]);

  const handleVersionChange = useCallback(() => {
    void loadDevices({ silent: true, force: true });
  }, [loadDevices]);

  useDevicesVersionPolling({
    onVersionChange: handleVersionChange,
  });

  useEffect(() => {
    let active = true;
    async function checkAlexaDevices() {
      try {
        const res = await fetch('/api/alexa/devices', {
          cache: 'no-store',
          credentials: 'include',
        });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          throw new Error(data.error || 'Failed to check Alexa devices');
        }
        const list = Array.isArray(data.devices) ? data.devices : [];
        setShowAlexaLink(list.length > 0);
      } catch {
        if (active) {
          setShowAlexaLink(false);
        }
      }
    }
    void checkAlexaDevices();
    return () => {
      active = false;
    };
  }, []);

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
      localStorage.setItem('tenantSelectedArea', resolvedSelectedArea);
    } catch (err) {
      console.warn('Unable to persist tenant area', err);
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

  const relatedDevices =
    openDevice && getGroupLabel(openDevice) === 'Home Security'
      ? devices.filter((d) => getGroupLabel(d) === 'Home Security')
      : undefined;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-3 pb-16 pt-8 sm:px-4 lg:pt-12">
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
                Dinodia Home
              </p>
              <div className="relative inline-block" ref={areaMenuRef}>
                <button
                  type="button"
                  onClick={() => setAreaMenuOpen((open) => !open)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-white"
                >
                  <span>
                    {resolvedSelectedArea === ALL_AREAS
                      ? 'My home'
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
                      All my rooms
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
              <p className="mt-1 text-xs text-slate-500">Connected Devices</p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
            <div className="w-full text-left sm:min-w-[140px] sm:text-right">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Today
              </p>
              <p>{clock}</p>
              {showAlexaLink && (
                <a
                  href={ALEXA_SKILL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm hover:bg-white"
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                    a
                  </span>
                  Alexa Link
                </a>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end sm:gap-3">
              <div className="relative hidden sm:block" ref={deviceMenuRef}>
                <button
                  type="button"
                  onClick={() => setDeviceMenuOpen((v) => !v)}
                  className="rounded-full bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                >
                  + Device
                </button>
                {deviceMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-100 bg-white/95 p-1 text-sm text-slate-700 shadow-lg backdrop-blur">
                    <Link
                      href="/tenant/devices/discovered"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setDeviceMenuOpen(false)}
                    >
                      Autodiscovered devices
                    </Link>
                    <Link
                      href="/tenant/devices/add"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setDeviceMenuOpen(false)}
                    >
                      Matter devices
                    </Link>
                  </div>
                )}
              </div>
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
                  <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-100 bg-white/95 p-1 text-sm text-slate-700 shadow-lg backdrop-blur">
                    <Link
                      href="/tenant/devices/add"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Add Matter Device
                    </Link>
                    <Link
                      href="/tenant/devices/discovered"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Add Discovered Device
                    </Link>
                    <Link
                      href="/tenant/settings"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      User Settings
                    </Link>
                    <Link
                      href="/tenant/automations"
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Home Automations
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
        <div className="space-y-10">
          {sortedLabels.map((label) => {
            if (label === OTHER_LABEL) return null;
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
                  <div className="grid grid-cols-1 gap-3 justify-items-center sm:justify-items-stretch sm:gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    {group.map((device) => (
                      <DeviceTile
                        key={device.entityId}
                        device={device}
                        batteryPercent={getBatteryPercentForDevice(device, batteryByGroup)}
                        onOpenDetails={() => setOpenDeviceId(device.entityId)}
                        onActionComplete={() => loadDevices({ silent: true, force: true })}
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}

          {sortedLabels.length === 0 && !isLoading && (
            <p className="rounded-3xl border border-slate-200/70 bg-white/70 px-6 py-10 text-center text-sm text-slate-500">
              No devices are linked to your account yet. Ask the homeowner who set up
              Dinodia to confirm your access.
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
          linkedSensors={linkedSensors}
          showAdminControls={false}
          allowSensorHistory
          historyEndpoint="/api/tenant/monitoring/history"
        />
      )}
    </div>
  );
}
