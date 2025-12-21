'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import type { UIDevice } from '@/types/device';
import { isDetailState, isSensorEntity } from '@/lib/deviceSensors';
import { getGroupLabel, normalizeLabel, OTHER_LABEL } from '@/lib/deviceLabels';

type AutomationListItem = {
  id: string;
  entityId?: string;
  alias: string;
  description: string;
  mode: string;
  entities: string[];
  hasTemplates: boolean;
  canEdit: boolean;
  enabled?: boolean;
};

type TriggerType = 'state' | 'schedule';

type CreateFormState = {
  alias: string;
  description: string;
  triggerType: TriggerType;
  triggerEntityId: string;
  triggerTo: string | number | '';
  scheduleAt: string;
  scheduleWeekdays: string[];
  actionEntityId: string;
  actionState: string | number | '';
  enabled: boolean;
};

const weekdayOptions = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
];

const defaultFormState: CreateFormState = {
  alias: '',
  description: '',
  triggerType: 'state',
  triggerEntityId: '',
  triggerTo: '',
  scheduleAt: '',
  scheduleWeekdays: [],
  actionEntityId: '',
  actionState: '',
  enabled: true,
};

type ControlMeta =
  | { kind: 'toggle'; options?: string[]; actionType?: 'toggle' | 'turn_on' | 'turn_off' }
  | {
      kind: 'slider';
      min: number;
      max: number;
      step?: number;
      actionType?: 'set_brightness' | 'set_cover_position' | 'set_temperature';
    }
  | { kind: 'number'; min?: number; max?: number; step?: number; actionType?: 'set_temperature' }
  | { kind: 'select'; options: string[]; actionType?: 'toggle' | 'turn_on' | 'turn_off' }
  | { kind: 'unknown'; actionType?: 'toggle' | 'turn_on' };

function getControlForDevice(device?: UIDevice): ControlMeta {
  if (!device) return { kind: 'unknown', actionType: 'toggle' };
  const label = device.label?.toLowerCase() ?? '';
  const domain = device.domain?.toLowerCase() ?? '';
  const isLight = label.includes('light') || domain === 'light';
  const isBlind = label.includes('blind') || domain === 'cover';
  const isMotion = label.includes('motion');
  const isTv = label.includes('tv') || label.includes('speaker') || domain === 'media_player';
  const isBoiler = label.includes('boiler') || domain === 'climate';
  const isDoorbell = label.includes('doorbell');
  const isSecurity = label.includes('security') || label.includes('alarm');
  const isSpotify = label.includes('spotify');

  if (isLight) return { kind: 'slider', min: 0, max: 100, step: 1, actionType: 'set_brightness' };
  if (isBlind || domain === 'cover')
    return { kind: 'slider', min: 0, max: 100, step: 1, actionType: 'set_cover_position' };
  if (isBoiler || domain === 'climate')
    return { kind: 'number', min: 5, max: 35, step: 0.5, actionType: 'set_temperature' };
  if (isMotion) return { kind: 'select', options: ['on', 'off'], actionType: 'toggle' };
  if (isTv || isSpotify || domain === 'media_player')
    return { kind: 'toggle', actionType: 'toggle' };
  if (isDoorbell) return { kind: 'select', options: ['pressed', 'idle'], actionType: 'toggle' };
  if (isSecurity)
    return { kind: 'select', options: ['armed', 'disarmed', 'triggered'], actionType: 'toggle' };
  if (domain === 'switch') return { kind: 'toggle', actionType: 'toggle' };
  return { kind: 'toggle', actionType: 'toggle' };
}

function renderControlInput(
  meta: ControlMeta,
  value: string | number | '',
  onChange: (v: string | number | '') => void,
  placeholder?: string
) {
  switch (meta.kind) {
    case 'toggle':
      return (
        <select
          value={value === '' ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select state</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      );
    case 'slider':
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={meta.min}
            max={meta.max}
            step={meta.step ?? 1}
            value={typeof value === 'number' ? value : meta.min}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 accent-indigo-600"
          />
          <input
            type="number"
            min={meta.min}
            max={meta.max}
            step={meta.step ?? 1}
            value={value}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      );
    case 'number':
      return (
        <input
          type="number"
          min={meta.min}
          max={meta.max}
          step={meta.step ?? 1}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder={placeholder}
        />
      );
    case 'select':
      return (
        <select
          value={value === '' ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select state</option>
          {meta.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder={placeholder ?? 'Enter state'}
        />
      );
  }
}

export default function TenantAutomations() {
  const [devices, setDevices] = useState<UIDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [automations, setAutomations] = useState<AutomationListItem[]>([]);
  const [loadingAutomations, setLoadingAutomations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateFormState>(defaultFormState);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const triggerDevice = useMemo(
    () => devices.find((d) => d.entityId === form.triggerEntityId),
    [devices, form.triggerEntityId]
  );
  const actionDevice = useMemo(
    () => devices.find((d) => d.entityId === form.actionEntityId),
    [devices, form.actionEntityId]
  );
  const fetchAutomations = async (entityId: string) => {
    setLoadingAutomations(true);
    try {
      const url =
        entityId && entityId.length > 0
          ? `/api/automations?entityId=${encodeURIComponent(entityId)}`
          : '/api/automations';
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load automations');
      const list: AutomationListItem[] = Array.isArray(data.automations)
        ? data.automations
        : [];
      setAutomations(list);
    } catch (err) {
      setError((err as Error).message || 'Failed to load automations');
    } finally {
      setLoadingAutomations(false);
    }
  };

  useEffect(() => {
    async function loadDevices() {
      setLoadingDevices(true);
      try {
        const res = await fetch('/api/devices?fresh=1', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load devices');
        const list: UIDevice[] = Array.isArray(data.devices) ? data.devices : [];
        setDevices(list);
      } catch (err) {
        setError((err as Error).message || 'Failed to load devices');
      } finally {
        setLoadingDevices(false);
      }
    }
    void loadDevices();
  }, []);

  useEffect(() => {
    void fetchAutomations(selectedEntityId);
  }, [selectedEntityId]);

  const deviceOptions = useMemo(() => {
    const baseEligible = devices.filter((d) => {
      const areaName = (d.area ?? d.areaName ?? '').trim();
      if (!areaName) return false;
      const labels = Array.isArray(d.labels) ? d.labels : [];
      const hasLabel =
        normalizeLabel(d.label).length > 0 ||
        labels.some((lbl) => normalizeLabel(lbl).length > 0);
      if (!hasLabel) return false;
      return getGroupLabel(d) !== OTHER_LABEL;
    });

    const tileEligible = baseEligible.filter((d) => !isDetailState(d.state));

    const tile: { value: string; label: string }[] = [];
    for (const d of tileEligible) {
      const areaName = (d.area ?? d.areaName ?? '').trim();
      const label = areaName ? `${d.name} (${areaName})` : d.name;
      tile.push({ value: d.entityId, label });
    }

    const triggerPrimary: { value: string; label: string }[] = [];
    const triggerSensors: { value: string; label: string }[] = [];
    for (const d of baseEligible) {
      const areaName = (d.area ?? d.areaName ?? '').trim();
      const label = areaName ? `${d.name} (${areaName})` : d.name;
      if (isSensorEntity(d)) {
        triggerSensors.push({ value: d.entityId, label });
      } else {
        triggerPrimary.push({ value: d.entityId, label });
      }
    }

    return {
      tile,
      triggerPrimary,
      triggerSensors,
    };
  }, [devices]);

  function updateForm<K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function deriveActionPayload(entityId: string, device: UIDevice | undefined, value: string | number | '') {
    const meta = getControlForDevice(device);
    const numericValue =
      typeof value === 'number' ? value : value === '' ? Number.NaN : Number(value);
    const hasNumber = Number.isFinite(numericValue);
    const lower = typeof value === 'string' ? value.toLowerCase() : '';

    if (meta.actionType === 'set_brightness') {
      if (!hasNumber) throw new Error('Choose a brightness level');
      return { type: 'set_brightness', entityId, value: numericValue };
    }
    if (meta.actionType === 'set_cover_position') {
      if (!hasNumber) throw new Error('Choose a blind position');
      return { type: 'set_cover_position', entityId, value: numericValue };
    }
    if (meta.actionType === 'set_temperature') {
      if (!hasNumber) throw new Error('Choose a temperature');
      return { type: 'set_temperature', entityId, value: numericValue };
    }

    if (lower === 'on') return { type: 'turn_on', entityId };
    if (lower === 'off') return { type: 'turn_off', entityId };

    if (meta.actionType === 'turn_on') return { type: 'turn_on', entityId };
    if (meta.actionType === 'turn_off') return { type: 'turn_off', entityId };

    return { type: 'toggle', entityId };
  }

  function buildPayload() {
    if (!form.alias.trim()) throw new Error('Name is required');
    if (!form.triggerEntityId && form.triggerType === 'state') {
      throw new Error('Trigger entity is required');
    }
    if (form.triggerType === 'state' && form.triggerTo === '') {
      throw new Error('Trigger state is required');
    }
    if (form.triggerType === 'schedule' && !form.scheduleAt) {
      throw new Error('Schedule time is required');
    }
    if (form.triggerType === 'schedule' && form.scheduleWeekdays.length === 0) {
      throw new Error('Select at least one day');
    }
    if (!form.actionEntityId) throw new Error('Action entity is required');
    if (form.actionState === '') throw new Error('Choose an action state');

    const payload: Record<string, unknown> = {
      alias: form.alias.trim(),
      description: form.description.trim(),
      mode: 'single',
      enabled: form.enabled,
    };

    if (form.triggerType === 'state') {
      payload.trigger = {
        type: 'state',
        entityId: form.triggerEntityId,
        to: form.triggerTo,
      };
    } else {
      payload.trigger = {
        type: 'schedule',
        scheduleType: 'weekly',
        at: form.scheduleAt,
        weekdays: form.scheduleWeekdays,
      };
    }

    payload.action = deriveActionPayload(form.actionEntityId, actionDevice, form.actionState);

    return payload;
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload();
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create automation');
      setForm({ ...defaultFormState });
      await fetchAutomations(selectedEntityId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/automations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      await fetchAutomations(selectedEntityId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    setTogglingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/automations/${encodeURIComponent(id)}/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update automation');
      await fetchAutomations(selectedEntityId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold leading-tight text-slate-900">Home Automations</h1>
        <p className="text-sm text-slate-500">
          Manage Home Assistant automations over Nabu Casa. Automations run instantly inside your Home Assistant; this page
          only edits them.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">View automations</h2>
              <p className="text-xs text-slate-500">
                Choose a device to see automations whose <strong>actions</strong> target it.
              </p>
            </div>
            <Link
              href="/tenant/dashboard"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Back to dashboard
            </Link>
          </div>
          <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <label className="text-xs font-medium text-slate-600">Device / Entity</label>
            <select
              value={selectedEntityId}
              onChange={(e) => setSelectedEntityId(e.target.value)}
              className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loadingDevices || devices.length === 0}
            >
              <option value="">None</option>
              {deviceOptions.tile.length > 0 && (
                <optgroup label="Primary devices">
                  {deviceOptions.tile.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {selectedEntityId ? 'Automations affecting this device' : 'All automations'}
          </h2>
          {loadingAutomations && <span className="text-xs text-slate-500">Loading…</span>}
        </div>
        {automations.length === 0 && !loadingAutomations && (
          <p className="text-sm text-slate-500">No automations found for this device.</p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {automations.map((auto) => (
            <div
              key={auto.id}
              className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-900">{auto.alias}</p>
                  <p className="text-xs text-slate-500">ID: {auto.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={auto.enabled ?? true}
                      onChange={(e) => void handleToggle(auto.id, e.target.checked)}
                      disabled={togglingId === auto.id}
                    />
                    {auto.enabled ? 'Enabled' : 'Disabled'}
                  </label>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    onClick={() => void handleDelete(auto.id)}
                    disabled={deletingId === auto.id}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-600">{auto.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-slate-100 px-2 py-0.5">Mode: {auto.mode}</span>
                {auto.entities.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5">
                    Entities: {auto.entities.join(', ')}
                  </span>
                )}
                {auto.hasTemplates && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                    Template detected (view only)
                  </span>
                )}
                {!auto.canEdit && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                    Read-only (outside your areas or templated)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Create automation</h2>
        <form className="space-y-4" onSubmit={handleCreate}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Name
              </label>
              <input
                type="text"
                value={form.alias}
                onChange={(e) => updateForm('alias', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Description (optional)
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => updateForm('description', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Trigger condition</h3>
                <select
                  value={form.triggerType}
                  onChange={(e) =>
                    updateForm('triggerType', e.target.value as TriggerType)
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="state">Device state</option>
                  <option value="schedule">Schedule</option>
                </select>
              </div>

              {form.triggerType === 'state' ? (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs">Entity</label>
                    <select
                      value={form.triggerEntityId}
                      onChange={(e) => updateForm('triggerEntityId', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">None</option>
                      {deviceOptions.triggerPrimary.length > 0 && (
                        <optgroup label="Primary devices">
                          {deviceOptions.triggerPrimary.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {deviceOptions.triggerSensors.length > 0 && (
                        <optgroup label="Sensors">
                          {deviceOptions.triggerSensors.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs">To state</label>
                    {renderControlInput(
                      getControlForDevice(triggerDevice),
                      form.triggerTo,
                      (v) => updateForm('triggerTo', v as string | number | '')
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">
                      Fires when this device changes from any state into the selected state.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs">Days</label>
                      <div className="flex flex-wrap gap-2">
                        {weekdayOptions.map((day) => {
                          const active = form.scheduleWeekdays.includes(day.value);
                          return (
                            <button
                              type="button"
                              key={day.value}
                              onClick={() => {
                                updateForm(
                                  'scheduleWeekdays',
                                  active
                                    ? form.scheduleWeekdays.filter((d) => d !== day.value)
                                    : [...form.scheduleWeekdays, day.value]
                                );
                              }}
                              className={`rounded-lg border px-3 py-1 text-xs ${
                                active
                                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                  : 'border-slate-200 bg-white text-slate-700'
                              }`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Select the days this schedule should run. Select all for daily.
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">At (HH:MM)</label>
                      <input
                        type="time"
                        value={form.scheduleAt}
                        onChange={(e) => updateForm('scheduleAt', e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Action</h3>
                <span className="text-[11px] text-slate-500">
                  Choose a device then change its state
                </span>
              </div>
              <div>
                <label className="mb-1 block text-xs">Entity</label>
                <select
                  value={form.actionEntityId}
                  onChange={(e) => updateForm('actionEntityId', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">None</option>
                  {deviceOptions.tile.length > 0 && (
                    <optgroup label="Primary devices">
                      {deviceOptions.tile.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs">Change state to</label>
                {renderControlInput(
                  getControlForDevice(actionDevice),
                  form.actionState,
                  (v) => updateForm('actionState', v as string | number | '')
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  Uses device-aware controls (dimmer for lights, position for blinds, etc.).
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  id="enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => updateForm('enabled', e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="enabled" className="text-sm text-slate-700">
                  Enabled
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setForm({ ...defaultFormState })}
            >
              Reset
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Create automation'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
