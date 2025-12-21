'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';

type UIDevice = {
  entityId: string;
  name: string;
  areaName: string | null;
  label?: string | null;
  domain?: string | null;
};

type AutomationListItem = {
  id: string;
  entityId?: string;
  alias: string;
  description: string;
  mode: string;
  entities: string[];
  hasTemplates: boolean;
  canEdit: boolean;
};

type TriggerType = 'state' | 'schedule';
type ScheduleType = 'daily' | 'weekly' | 'monthly';
type ActionType = 'toggle' | 'turn_on' | 'turn_off' | 'set_brightness' | 'set_temperature';

type CreateFormState = {
  alias: string;
  description: string;
  triggerType: TriggerType;
  triggerEntityId: string;
  triggerTo: string;
  triggerFrom: string;
  triggerForSeconds: number | '';
  scheduleType: ScheduleType;
  scheduleAt: string;
  scheduleWeekdays: string[];
  scheduleDay: number | '';
  actionType: ActionType;
  actionEntityId: string;
  actionValue: number | '';
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
  triggerTo: 'on',
  triggerFrom: '',
  triggerForSeconds: '',
  scheduleType: 'daily',
  scheduleAt: '11:00',
  scheduleWeekdays: ['mon'],
  scheduleDay: 1,
  actionType: 'turn_on',
  actionEntityId: '',
  actionValue: '',
  enabled: true,
};

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
  const fetchAutomations = async (entityId: string) => {
    if (!entityId) return;
    setLoadingAutomations(true);
    try {
      const res = await fetch(`/api/automations?entityId=${encodeURIComponent(entityId)}`, {
        credentials: 'include',
      });
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
        if (list.length > 0) {
          setSelectedEntityId(list[0].entityId);
          setForm((prev) => ({
            ...prev,
            triggerEntityId: prev.triggerEntityId || list[0].entityId,
            actionEntityId: prev.actionEntityId || list[0].entityId,
          }));
        }
      } catch (err) {
        setError((err as Error).message || 'Failed to load devices');
      } finally {
        setLoadingDevices(false);
      }
    }
    void loadDevices();
  }, []);

  useEffect(() => {
    if (!selectedEntityId) return;
    void fetchAutomations(selectedEntityId);
  }, [selectedEntityId]);

  const deviceOptions = useMemo(() => {
    return devices.map((d) => ({
      value: d.entityId,
      label: `${d.name}${d.areaName ? ` (${d.areaName})` : ''}`,
    }));
  }, [devices]);

  function updateForm<K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildPayload() {
    if (!form.alias.trim()) throw new Error('Name is required');
    if (!form.triggerEntityId && form.triggerType === 'state') {
      throw new Error('Trigger entity is required');
    }
    if (!form.actionEntityId) throw new Error('Action entity is required');

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
        to: form.triggerTo || undefined,
        from: form.triggerFrom || undefined,
        forSeconds:
          typeof form.triggerForSeconds === 'number'
            ? form.triggerForSeconds
            : undefined,
      };
    } else {
      payload.trigger = {
        type: 'schedule',
        scheduleType: form.scheduleType,
        at: form.scheduleAt,
        weekdays: form.scheduleType === 'weekly' ? form.scheduleWeekdays : undefined,
        day: form.scheduleType === 'monthly' ? form.scheduleDay : undefined,
      };
    }

    payload.action = (() => {
      switch (form.actionType) {
        case 'toggle':
        case 'turn_on':
        case 'turn_off':
          return { type: form.actionType, entityId: form.actionEntityId };
        case 'set_brightness':
          return {
            type: 'set_brightness',
            entityId: form.actionEntityId,
            value:
              typeof form.actionValue === 'number' ? form.actionValue : 50,
          };
        case 'set_temperature':
          return {
            type: 'set_temperature',
            entityId: form.actionEntityId,
            value:
              typeof form.actionValue === 'number' ? form.actionValue : 20,
          };
        default:
          return { type: 'turn_on', entityId: form.actionEntityId };
      }
    })();

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
      setForm((prev) => ({
        ...defaultFormState,
        triggerEntityId: prev.triggerEntityId || selectedEntityId,
        actionEntityId: prev.actionEntityId || selectedEntityId,
      }));
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

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Device / Entity</label>
            <select
              value={selectedEntityId}
              onChange={(e) => setSelectedEntityId(e.target.value)}
              className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loadingDevices || devices.length === 0}
            >
              {deviceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <Link
            href="/tenant/dashboard"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Automations for this device</h2>
          {loadingAutomations && (
            <span className="text-xs text-slate-500">Loading…</span>
          )}
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void handleToggle(auto.id, true)}
                    disabled={togglingId === auto.id}
                  >
                    Enable
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void handleToggle(auto.id, false)}
                    disabled={togglingId === auto.id}
                  >
                    Disable
                  </button>
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
                <h3 className="text-sm font-semibold text-slate-800">Trigger</h3>
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
                      {deviceOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs">To state</label>
                      <input
                        type="text"
                        value={form.triggerTo}
                        onChange={(e) => updateForm('triggerTo', e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">From state</label>
                      <input
                        type="text"
                        value={form.triggerFrom}
                        onChange={(e) => updateForm('triggerFrom', e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">For (sec)</label>
                      <input
                        type="number"
                        min={0}
                        value={form.triggerForSeconds}
                        onChange={(e) =>
                          updateForm(
                            'triggerForSeconds',
                            e.target.value === '' ? '' : Number(e.target.value)
                          )
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs">Schedule type</label>
                      <select
                        value={form.scheduleType}
                        onChange={(e) =>
                          updateForm('scheduleType', e.target.value as ScheduleType)
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
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
                  {form.scheduleType === 'weekly' && (
                    <div>
                      <label className="mb-1 block text-xs">Weekdays</label>
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
                    </div>
                  )}
                  {form.scheduleType === 'monthly' && (
                    <div>
                      <label className="mb-1 block text-xs">Day of month</label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={form.scheduleDay}
                        onChange={(e) =>
                          updateForm(
                            'scheduleDay',
                            e.target.value === '' ? '' : Number(e.target.value)
                          )
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Action</h3>
                <select
                  value={form.actionType}
                  onChange={(e) =>
                    updateForm('actionType', e.target.value as ActionType)
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="turn_on">Turn on</option>
                  <option value="turn_off">Turn off</option>
                  <option value="toggle">Toggle</option>
                  <option value="set_brightness">Set brightness</option>
                  <option value="set_temperature">Set temperature</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs">Entity</label>
                <select
                  value={form.actionEntityId}
                  onChange={(e) => updateForm('actionEntityId', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {deviceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              {(form.actionType === 'set_brightness' || form.actionType === 'set_temperature') && (
                <div>
                  <label className="mb-1 block text-xs">
                    {form.actionType === 'set_brightness' ? 'Brightness (0-100)' : 'Temperature'}
                  </label>
                  <input
                    type="number"
                    value={form.actionValue}
                    onChange={(e) =>
                      updateForm(
                        'actionValue',
                        e.target.value === '' ? '' : Number(e.target.value)
                      )
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
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
              onClick={() => setForm(defaultFormState)}
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
