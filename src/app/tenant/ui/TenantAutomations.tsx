'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import type { UIDevice } from '@/types/device';
import { isDetailState } from '@/lib/deviceSensors';
import {
  DeviceActionSpec,
  DeviceTriggerSpec,
  getActionsForDevice,
  getEligibleDevicesForAutomations,
  getTriggersForDevice,
} from '@/lib/deviceCapabilities';

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
  raw?: {
    triggers?: unknown[];
    trigger?: unknown[];
    conditions?: unknown[];
    condition?: unknown[];
    actions?: unknown[];
    action?: unknown[];
    [key: string]: unknown;
  };
};

type CreateFormState = {
  alias: string;
  description: string;
  anyTime: boolean;
  triggerEntityId: string;
  triggerMode: 'state_equals' | 'attribute_delta' | 'position_equals';
  triggerTo: string | number | '';
  triggerDirection: 'increased' | 'decreased' | '';
  triggerAttribute: string | '';
  scheduleAt: string;
  scheduleWeekdays: string[];
  actionEntityId: string;
  actionCommand: string;
  actionValue: string | number | '';
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
  anyTime: true,
  triggerEntityId: '',
  triggerMode: 'state_equals',
  triggerTo: '',
  triggerDirection: '',
  triggerAttribute: '',
  scheduleAt: '',
  scheduleWeekdays: weekdayOptions.map((d) => d.value),
  actionEntityId: '',
  actionCommand: '',
  actionValue: '',
  enabled: true,
};

type DeviceOptions = {
  tile: { value: string; label: string }[];
  triggerDevices: { value: string; label: string }[];
};

function buildLabel(d: UIDevice) {
  const areaName = (d.area ?? d.areaName ?? '').trim();
  return areaName ? `${d.name} (${areaName})` : d.name;
}

function buildDeviceOptions(devices: UIDevice[]): DeviceOptions {
  const baseEligible = getEligibleDevicesForAutomations(devices);
  const tileEligible = baseEligible.filter((d) => !isDetailState(d.state));

  const tile = tileEligible.map((d) => ({ value: d.entityId, label: buildLabel(d) }));
  const triggerDevices = baseEligible.map((d) => ({ value: d.entityId, label: buildLabel(d) }));

  return { tile, triggerDevices };
}

function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (Array.isArray(val)) return val;
  if (val === undefined || val === null) return [];
  return [val];
}

type HaLikeObject = Record<string, unknown>;

function getTriggerSummary(trigger: unknown, devices: UIDevice[]): string {
  if (!trigger || typeof trigger !== 'object') return 'Custom trigger';
  const t = trigger as HaLikeObject;
  const entityCandidate = t.entity_id ?? t.entityId;
  const entity = toArray<string>(
    typeof entityCandidate === 'string' || Array.isArray(entityCandidate)
      ? (entityCandidate as string | string[])
      : undefined
  )[0];
  const friendly =
    devices.find((d) => d.entityId === entity)?.name || entity || 'Unknown entity';
  const platform = typeof t.platform === 'string' ? t.platform : (t.trigger as string | undefined);
  if (platform === 'time') {
    const at = typeof t.at === 'string' ? t.at : '';
    const weekdayValue = t.weekday;
    const weekdays = toArray<string>(
      Array.isArray(weekdayValue) || typeof weekdayValue === 'string'
        ? (weekdayValue as string | string[])
        : undefined
    ).join(', ');
    return `Time: ${at}${weekdays ? ` on ${weekdays}` : ''}`;
  }
  if (platform === 'state') {
    const to = (t.to as string | undefined) ?? (t.state as string | undefined);
    return `State: ${friendly}${to ? ` → ${to}` : ''}`;
  }
  return 'Custom trigger';
}

function getActionEntity(action: unknown): string | null {
  if (!action || typeof action !== 'object') return null;
  const target = (action as HaLikeObject).target as HaLikeObject | undefined;
  const candidate = target?.entity_id ?? (action as HaLikeObject).entity_id ?? null;
  if (Array.isArray(candidate)) return candidate[0] ?? null;
  return typeof candidate === 'string' ? candidate : null;
}

function getActionSummary(
  action: unknown,
  devices: UIDevice[]
): { summary: string; primaryName?: string } {
  if (!action || typeof action !== 'object') return { summary: 'Custom action' };
  const a = action as HaLikeObject;
  const service = typeof a.service === 'string' ? a.service : undefined;
  const data = (a.data && typeof a.data === 'object' ? a.data : {}) as HaLikeObject;
  const entityId = getActionEntity(a);
  const friendly =
    devices.find((d) => d.entityId === entityId)?.name || entityId || 'Unknown device';

  if (!service) return { summary: `Custom action on ${friendly}`, primaryName: friendly };

  if (service === 'cover.set_cover_position') {
    const pos = data.position ?? data.percentage;
    return { summary: `Set ${friendly} to ${pos}%`, primaryName: friendly };
  }
  if (service === 'climate.set_temperature') {
    return { summary: `Set ${friendly} temperature to ${data.temperature ?? ''}`, primaryName: friendly };
  }
  if (service === 'light.turn_on') {
    if (data.brightness_pct !== undefined) {
      return { summary: `Set ${friendly} brightness to ${data.brightness_pct}%`, primaryName: friendly };
    }
    return { summary: `Turn on ${friendly}`, primaryName: friendly };
  }
  if (service === 'homeassistant.turn_on') {
    return { summary: `Turn on ${friendly}`, primaryName: friendly };
  }
  if (service === 'homeassistant.turn_off' || service === 'light.turn_off') {
    return { summary: `Turn off ${friendly}`, primaryName: friendly };
  }
  if (service === 'homeassistant.toggle') {
    return { summary: `Toggle ${friendly}`, primaryName: friendly };
  }
  if (service === 'media_player.volume_set') {
    const vol = data.volume_level ? Math.round(Number(data.volume_level) * 100) : undefined;
    return { summary: `Set ${friendly} volume to ${vol ?? ''}%`, primaryName: friendly };
  }
  if (service === 'media_player.media_play_pause') {
    return { summary: `Play/Pause ${friendly}`, primaryName: friendly };
  }
  return { summary: `${service} on ${friendly}`, primaryName: friendly };
}

function summarizeAutomation(auto: AutomationListItem, devices: UIDevice[]) {
  const raw = auto.raw ?? {};
  const triggers = toArray(raw.triggers ?? raw.trigger);
  const actions = toArray(raw.actions ?? raw.action);
  const triggerSummary = triggers.length > 0 ? getTriggerSummary(triggers[0], devices) : '—';
  const actionSummary = actions.length > 0 ? getActionSummary(actions[0], devices) : { summary: '—' };
  return {
    triggerSummary,
    actionSummary: actionSummary.summary,
    primaryName: actionSummary.primaryName,
  };
}

function renderActionInput(
  spec: DeviceActionSpec | null,
  value: string | number | '',
  onChange: (v: string | number | '') => void
) {
  if (!spec) return null;
  switch (spec.kind) {
    case 'command':
      return <p className="text-sm text-slate-500">No additional input required.</p>;
    case 'slider':
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={typeof value === 'number' ? value : spec.min}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 accent-indigo-600"
          />
          <input
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={value}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      );
    case 'fixed-position':
      return (
        <select
          value={value === '' ? '' : value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select position</option>
          {spec.positions.map((pos) => (
            <option key={pos.value} value={pos.value}>
              {pos.label}
            </option>
          ))}
        </select>
      );
    default:
      return null;
  }
}

function renderTriggerInput(
  spec: DeviceTriggerSpec | null,
  form: CreateFormState,
  onChange: (updates: Partial<CreateFormState>) => void
) {
  if (!spec) return <p className="text-sm text-slate-500">No triggers available for this device.</p>;

  switch (spec.type) {
    case 'state_equals':
      return (
        <select
          value={form.triggerTo}
          onChange={(e) => onChange({ triggerTo: e.target.value })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select state</option>
          {spec.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'attribute_delta':
      return (
        <select
          value={form.triggerDirection}
          onChange={(e) =>
            onChange({
              triggerDirection: e.target.value as CreateFormState['triggerDirection'],
              triggerAttribute: spec.attributes[0] ?? '',
            })
          }
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select change</option>
          {spec.directionOptions.map((dir) => (
            <option key={dir} value={dir}>
              {dir === 'increased' ? 'Increased' : 'Decreased'}
            </option>
          ))}
        </select>
      );
    case 'position_equals':
      return (
        <select
          value={form.triggerTo}
          onChange={(e) =>
            onChange({
              triggerTo: Number(e.target.value),
              triggerAttribute: spec.attributes[0] ?? '',
            })
          }
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select position</option>
          {spec.values.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      );
    default:
      return null;
  }
}

export default function TenantAutomations() {
  const [automations, setAutomations] = useState<AutomationListItem[]>([]);
  const [loadingAutomations, setLoadingAutomations] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [devices, setDevices] = useState<UIDevice[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [form, setForm] = useState<CreateFormState>({ ...defaultFormState });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const actionDevice = devices.find((d) => d.entityId === form.actionEntityId);
  const triggerDevice = devices.find((d) => d.entityId === form.triggerEntityId);

  const deviceOptions = useMemo(() => buildDeviceOptions(devices), [devices]);

  const triggerSpecs = useMemo(
    () => (triggerDevice ? getTriggersForDevice(triggerDevice, 'automation') : []),
    [triggerDevice]
  );
  const actionSpecs = useMemo(
    () => (actionDevice ? getActionsForDevice(actionDevice, 'automation') : []),
    [actionDevice]
  );

  async function fetchAndSetAutomations(entityId?: string) {
    setLoadingAutomations(true);
    try {
      const url = entityId ? `/api/automations?entityId=${encodeURIComponent(entityId)}` : '/api/automations';
      const res = await fetch(url, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch automations');
      const list: AutomationListItem[] = Array.isArray(data.automations)
        ? data.automations
        : [];
      setAutomations(list);
    } catch (err) {
      setError((err as Error).message || 'Failed to load automations');
    } finally {
      setLoadingAutomations(false);
    }
  }

  useEffect(() => {
    void fetchAndSetAutomations(selectedEntityId);
  }, [selectedEntityId]);

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

  function resetActionFields(specs: DeviceActionSpec[]) {
    const first = specs[0];
    if (!first) {
      setForm((prev) => ({ ...prev, actionCommand: '', actionValue: '' }));
      return;
    }
    if (first.kind === 'slider') {
      setForm((prev) => ({
        ...prev,
        actionCommand: first.id,
        actionValue: first.min,
      }));
    } else if (first.kind === 'fixed-position') {
      const val = first.positions[0]?.value ?? '';
      setForm((prev) => ({
        ...prev,
        actionCommand: first.id,
        actionValue: val,
      }));
    } else if (first.kind === 'command') {
      setForm((prev) => ({ ...prev, actionCommand: first.id, actionValue: '' }));
    }
  }

  function resetTriggerFields(specs: DeviceTriggerSpec[]) {
    const first = specs[0];
    if (!first) {
      setForm((prev) => ({
        ...prev,
        triggerMode: 'state_equals',
        triggerTo: '',
        triggerDirection: '',
        triggerAttribute: '',
      }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      triggerMode: first.type,
      triggerTo: first.type === 'position_equals' ? first.values[0]?.value ?? '' : '',
      triggerDirection: first.type === 'attribute_delta' ? first.directionOptions[0] ?? '' : '',
      triggerAttribute:
        first.type === 'attribute_delta'
          ? first.attributes[0] ?? ''
          : first.type === 'position_equals'
          ? first.attributes[0] ?? ''
          : '',
    }));
  }

  function updateForm<K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildPayload() {
    if (!form.alias.trim()) throw new Error('Name is required');
    if (form.anyTime) {
      if (!form.triggerEntityId) throw new Error('Trigger entity is required');
      if (form.triggerMode === 'state_equals' && form.triggerTo === '') {
        throw new Error('Trigger state is required');
      }
      if (form.triggerMode === 'attribute_delta' && !form.triggerDirection) {
        throw new Error('Select increased or decreased');
      }
      if (form.triggerMode === 'position_equals' && form.triggerTo === '') {
        throw new Error('Trigger position is required');
      }
    } else {
      if (!form.scheduleAt) throw new Error('Schedule time is required');
    }
    if (!form.actionEntityId) throw new Error('Action entity is required');
    if (!form.actionCommand) throw new Error('Choose an action');

    const payload: Record<string, unknown> = {
      alias: form.alias.trim(),
      description: form.description.trim(),
      mode: 'single',
      enabled: form.enabled,
    };

    if (form.anyTime) {
      payload.trigger = {
        type: 'device',
        entityId: form.triggerEntityId,
        mode: form.triggerMode,
        to: form.triggerTo,
        direction: form.triggerDirection || undefined,
        attribute: form.triggerAttribute || undefined,
        weekdays: form.scheduleWeekdays,
      };
    } else {
      payload.trigger = {
        type: 'schedule',
        scheduleType: 'weekly',
        at: form.scheduleAt,
        weekdays: form.scheduleWeekdays,
      };
    }

    payload.action = {
      type: 'device_command',
      entityId: form.actionEntityId,
      command: form.actionCommand,
      value: form.actionValue === '' ? undefined : form.actionValue,
    };

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
      if (!res.ok) throw new Error(data.error || 'Failed to save automation');
      setForm({ ...defaultFormState });
      await fetchAndSetAutomations(selectedEntityId);
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
      await fetchAndSetAutomations(selectedEntityId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    resetTriggerFields(triggerSpecs);
  }, [form.triggerEntityId, triggerSpecs]);

  useEffect(() => {
    resetActionFields(actionSpecs);
  }, [form.actionEntityId, actionSpecs]);

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
          {automations.map((auto) => {
            const summary = summarizeAutomation(auto, devices);
            return (
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
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                        auto.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {auto.enabled ? 'Enabled' : 'Disabled'}
                    </span>
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
                  {summary.primaryName && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">
                      Target: {summary.primaryName}
                    </span>
                  )}
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
                <div className="mt-2 space-y-1 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-800">Trigger:</span>{' '}
                    {summary.triggerSummary}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">Action:</span>{' '}
                    {summary.actionSummary}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Create automation</h2>
        </div>
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
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Days (optional)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {weekdayOptions.map((day) => (
                      <label
                        key={day.value}
                        className={`cursor-pointer rounded-lg border px-3 py-1 text-xs ${
                          form.scheduleWeekdays.includes(day.value)
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={form.scheduleWeekdays.includes(day.value)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setForm((prev) => ({
                              ...prev,
                              scheduleWeekdays: checked
                                ? Array.from(new Set([...prev.scheduleWeekdays, day.value]))
                                : prev.scheduleWeekdays.filter((d) => d !== day.value),
                            }));
                          }}
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Leave empty for any day. Applied to both time and device triggers.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Time
                      </label>
                      <input
                        type="time"
                        value={form.scheduleAt}
                        disabled={form.anyTime}
                        onChange={(e) => updateForm('scheduleAt', e.target.value)}
                        className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${
                          form.anyTime ? 'bg-slate-100 text-slate-400 line-through' : ''
                        }`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => updateForm('anyTime', !form.anyTime)}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                        form.anyTime
                          ? 'border border-indigo-200 bg-indigo-50 text-indigo-700'
                          : 'border border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {form.anyTime ? 'Any Time (on)' : 'Any Time (off)'}
                    </button>
                  </div>
                  {!form.anyTime && (
                    <p className="text-[11px] text-slate-500">
                      Time + Days trigger; device triggers are disabled in this mode.
                    </p>
                  )}
                  {form.anyTime && (
                    <p className="text-[11px] text-slate-500">
                      Any time of day; device trigger below will be used (respecting selected days).
                    </p>
                  )}
                </div>

                {form.anyTime && (
                  <div className="space-y-2">
                    <div>
                      <label className="mb-1 block text-xs">Trigger device</label>
                      <select
                        value={form.triggerEntityId}
                        onChange={(e) => updateForm('triggerEntityId', e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">None</option>
                        {deviceOptions.triggerDevices.length > 0 && (
                          <optgroup label="Devices">
                            {deviceOptions.triggerDevices.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    {triggerDevice && triggerSpecs.length > 0 && (
                      <>
                        <div>
                          <label className="mb-1 block text-xs">Trigger type</label>
                          <select
                            value={form.triggerMode}
                            onChange={(e) =>
                              updateForm('triggerMode', e.target.value as CreateFormState['triggerMode'])
                            }
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {triggerSpecs.map((spec) => (
                              <option key={spec.type} value={spec.type}>
                                {spec.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs">Trigger value</label>
                          {renderTriggerInput(
                            triggerSpecs.find((s) => s.type === form.triggerMode) ?? triggerSpecs[0] ?? null,
                            form,
                            (updates) => setForm((prev) => ({ ...prev, ...updates }))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
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
              {actionDevice && actionSpecs.length > 0 && (
                <>
                  <div>
                    <label className="mb-1 block text-xs">Action</label>
                    <select
                      value={form.actionCommand}
                      onChange={(e) => updateForm('actionCommand', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Select action</option>
                      {actionSpecs.map((spec) => (
                        <option key={spec.id} value={spec.id}>
                          {spec.kind === 'fixed-position'
                            ? 'Set position'
                            : spec.label ?? spec.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs">Change state to</label>
                    {renderActionInput(
                      actionSpecs.find((s) => s.id === form.actionCommand) ??
                        actionSpecs.find((s) => s.id) ??
                        null,
                      form.actionValue,
                      (v) => updateForm('actionValue', v)
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">
                      Uses dashboard-aligned controls (brightness, position, power, etc.).
                    </p>
                  </div>
                </>
              )}
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
              onClick={() => {
                setForm({ ...defaultFormState });
              }}
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
