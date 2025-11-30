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
import { DeviceControls } from '@/components/device/DeviceControls';

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

export default function AdminDashboard({ username }: Props) {
  const [devices, setDevices] = useState<UIDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({});
  const [openEditor, setOpenEditor] = useState<string | null>(null);
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
        setEditValues((prev) => {
          const next = { ...prev };
          for (const d of list) {
            if (openEditor === d.entityId) continue;
            next[d.entityId] = {
              name: d.name,
              area: d.area ?? d.areaName ?? '',
              label:
                d.label ??
                (Array.isArray(d.labels) && d.labels.length > 0
                  ? d.labels[0]
                  : d.labelCategory ?? ''),
            };
          }
          return next;
        });
      }
    } catch (err) {
      console.error(err);
      if (showSpinner) setLoadingDevices(false);
      setError('Failed to load devices');
    }
  }, [openEditor]);

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

  function toggleEditor(entityId: string) {
    setOpenEditor((prev) => (prev === entityId ? null : entityId));
  }

  function updateEditValue(
    entityId: string,
    key: keyof EditValues[string],
    value: string
  ) {
    setEditValues((prev) => ({
      ...prev,
      [entityId]: {
        ...(prev[entityId] || { name: '', area: '', label: '' }),
        [key]: value,
      },
    }));
  }

  async function saveDevice(entityId: string) {
    const current = editValues[entityId];
    if (!current) return;

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
      setMessage('Device settings saved ✅');
      setOpenEditor(null);
      previousDevicesRef.current = null;
      loadDevices();
    }
  }

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
    const map = new Map<
      string,
      {
        primary: UIDevice[];
        detail: UIDevice[];
      }
    >();
    visibleDevices.forEach((device) => {
      const key = getGroupLabel(device);
      if (!map.has(key)) {
        map.set(key, { primary: [], detail: [] });
      }
      const bucket = map.get(key)!;
      if (isDetailDevice(device.state)) bucket.detail.push(device);
      else bucket.primary.push(device);
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
          <h1 className="text-2xl font-semibold">Dinodia Admin Dashboard</h1>
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
      {message && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          {message}
        </div>
      )}

      <div className="flex flex-col gap-6">
        {sortedLabels.map((label) => {
          const buckets = labelGroups.get(label);
          if (!buckets) return null;
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase">
                    Controls
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {buckets.primary.length === 0 ? (
                      <p className="text-[11px] text-slate-400">
                        No primary devices in this label.
                      </p>
                    ) : (
                      buckets.primary.map((device) => (
                        <AdminDeviceCard
                          key={device.entityId}
                          device={device}
                          isDetail={false}
                          editValues={editValues}
                          openEditor={openEditor}
                          toggleEditor={toggleEditor}
                          updateEditValue={updateEditValue}
                          saveDevice={saveDevice}
                          refresh={loadDevices}
                        />
                      ))
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase">
                    Details
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {buckets.detail.length === 0 ? (
                      <p className="text-[11px] text-slate-400">
                        No detail devices in this label.
                      </p>
                    ) : (
                      buckets.detail.map((device) => (
                        <AdminDeviceCard
                          key={device.entityId}
                          device={device}
                          isDetail
                          editValues={editValues}
                          openEditor={openEditor}
                          toggleEditor={toggleEditor}
                          updateEditValue={updateEditValue}
                          saveDevice={saveDevice}
                          refresh={loadDevices}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          );
        })}

{sortedLabels.length === 0 && !loadingDevices && (
  <p className="text-sm text-slate-500">
    No devices with both area and label were found. Confirm your Home
    Assistant labels and areas.
  </p>
)}
      </div>
    </div>
  );
}

type AdminDeviceCardProps = {
  device: UIDevice;
  isDetail: boolean;
  editValues: EditValues;
  openEditor: string | null;
  toggleEditor: (id: string) => void;
  updateEditValue: (
    entityId: string,
    key: keyof EditValues[string],
    value: string
  ) => void;
  saveDevice: (entityId: string) => Promise<void>;
  refresh: () => void;
};

function AdminDeviceCard({
  device,
  isDetail,
  editValues,
  openEditor,
  toggleEditor,
  updateEditValue,
  saveDevice,
  refresh,
}: AdminDeviceCardProps) {
  const edit = editValues[device.entityId] || {
    name: device.name,
    area: device.area ?? device.areaName ?? '',
    label: getPrimaryLabel(device),
  };
  const isEditing = openEditor === device.entityId;

  return (
    <div className="min-w-[220px] border border-slate-200 rounded-xl p-4 text-xs shadow-sm flex-shrink-0">
      <DeviceControls
        device={device}
        isDetail={isDetail}
        onActionComplete={refresh}
        actionSlot={
          <button
            onClick={() => toggleEditor(device.entityId)}
            className="text-slate-400 hover:text-slate-600 text-sm"
            aria-label="Edit area or label"
          >
            ⋯
          </button>
        }
      />
      {isEditing && (
        <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
          <div>
            <label className="block text-[11px] mb-1">Display name</label>
            <input
              className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
              value={edit.name}
              onChange={(e) => updateEditValue(device.entityId, 'name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] mb-1">Area</label>
            <input
              className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
              value={edit.area}
              onChange={(e) => updateEditValue(device.entityId, 'area', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] mb-1">Label</label>
            <input
              className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
              value={edit.label}
              onChange={(e) => updateEditValue(device.entityId, 'label', e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => saveDevice(device.entityId)}
              className="text-[11px] bg-indigo-600 text-white rounded-md px-3 py-1 font-medium hover:bg-indigo-700"
            >
              Save
            </button>
            <button
              onClick={() => toggleEditor(device.entityId)}
              className="text-[11px] text-slate-500 px-3 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
