'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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

type EditValues = Record<
  string,
  {
    name: string;
    area: string;
    label: string;
  }
>;

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

export default function AdminDashboard({ username }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
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

      const list: Device[] = data.devices || [];
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
          normalizeDisplayLabel(d.label).length > 0 ||
          labels.some((lbl) => normalizeDisplayLabel(lbl).length > 0);
        return areaName.length > 0 && hasLabel;
      }),
    [devices]
  );

  const labelGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        primary: Device[];
        detail: Device[];
      }
    >();
    visibleDevices.forEach((device) => {
      const key = getGroupKey(device);
      if (!map.has(key)) {
        map.set(key, { primary: [], detail: [] });
      }
      const bucket = map.get(key)!;
      if (isDetailDevice(device.state)) bucket.detail.push(device);
      else bucket.primary.push(device);
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
                        <DeviceTile
                          key={device.entityId}
                          device={device}
                          editValues={editValues}
                          openEditor={openEditor}
                          toggleEditor={toggleEditor}
                          updateEditValue={updateEditValue}
                          saveDevice={saveDevice}
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
                        <DeviceTile
                          key={device.entityId}
                          device={device}
                          editValues={editValues}
                          openEditor={openEditor}
                          toggleEditor={toggleEditor}
                          updateEditValue={updateEditValue}
                          saveDevice={saveDevice}
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

function DeviceTile({
  device,
  editValues,
  openEditor,
  toggleEditor,
  updateEditValue,
  saveDevice,
}: {
  device: Device;
  editValues: EditValues;
  openEditor: string | null;
  toggleEditor: (entityId: string) => void;
  updateEditValue: (
    entityId: string,
    key: keyof EditValues[string],
    value: string
  ) => void;
  saveDevice: (entityId: string) => Promise<void>;
}) {
  const edit = editValues[device.entityId] || {
    name: device.name,
    area: device.area ?? device.areaName ?? '',
    label: device.label ?? device.labelCategory ?? device.labels?.[0] ?? '',
  };
  const isEditing = openEditor === device.entityId;
  const badgeLabel = getPrimaryLabel(device);
  const areaDisplay = (device.area ?? device.areaName ?? '').trim();
  const additionalLabels =
    Array.isArray(device.labels) && device.labels.length > 0
      ? device.labels
          .map((lbl) => normalizeDisplayLabel(lbl))
          .filter(
            (lbl) =>
              lbl.length > 0 &&
              lbl.toLowerCase() !== badgeLabel.toLowerCase()
          )
      : [];

  return (
    <div className="min-w-[220px] border border-slate-200 rounded-xl p-4 text-xs shadow-sm flex-shrink-0">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-800">{device.name}</p>
          {badgeLabel && (
            <span className="inline-flex text-[10px] uppercase tracking-wide text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">
              {badgeLabel}
            </span>
          )}
          {additionalLabels.length > 0 && (
            <p className="text-[10px] text-slate-500">
              {additionalLabels.join(', ')}
            </p>
          )}
        </div>
        <button
          onClick={() => toggleEditor(device.entityId)}
          className="text-slate-400 hover:text-slate-600 text-sm"
          aria-label="Edit area or label"
        >
          ⋯
        </button>
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

      {isEditing && (
        <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
          <div>
            <label className="block text-[11px] mb-1">Display name</label>
            <input
              className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
              value={edit.name}
              onChange={(e) =>
                updateEditValue(device.entityId, 'name', e.target.value)
              }
            />
          </div>
          <div>
            <label className="block text-[11px] mb-1">Area</label>
            <input
              className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
              value={edit.area}
              onChange={(e) =>
                updateEditValue(device.entityId, 'area', e.target.value)
              }
            />
          </div>
          <div>
            <label className="block text-[11px] mb-1">Label</label>
            <input
              className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
              value={edit.label}
              onChange={(e) =>
                updateEditValue(device.entityId, 'label', e.target.value)
              }
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
