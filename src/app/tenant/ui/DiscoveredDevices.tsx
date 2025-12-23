'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HaConfigFlowStep } from '@/lib/haConfigFlow';

type Props = {
  areas: string[];
  capabilityOptions: string[];
};

type DiscoveryFlow = {
  flowId: string;
  handler: string;
  source: string | null;
  title: string;
  description: string | null;
};

type SessionPayload = {
  id: string;
  status: string;
  requestedArea: string;
  requestedName: string | null;
  requestedDinodiaType: string | null;
  requestedHaLabelId: string | null;
  haFlowId: string | null;
  error: string | null;
  lastHaStep?: HaConfigFlowStep | null;
  newDeviceIds: string[];
  newEntityIds: string[];
  isFinal?: boolean;
};

type LabelOption = { label_id: string; name: string };

type SchemaField = {
  name: string;
  label: string;
  required: boolean;
  type: 'string' | 'password' | 'boolean' | 'select';
  options?: { value: string; label: string }[];
  defaultValue?: unknown;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function buildStatusMessage(session: SessionPayload | null) {
  if (!session) return 'Waiting to start setup...';
  if (session.status === 'SUCCEEDED') return 'Device added successfully';
  if (session.status === 'FAILED') return session.error || 'Setup failed';
  if (session.status === 'CANCELED') return 'Setup was canceled';
  const lastStep = session.lastHaStep;
  if (lastStep?.type === 'progress' || lastStep?.progress_action === 'wait') {
    return 'Home Assistant is configuring the device...';
  }
  if (lastStep?.type === 'form') return 'Home Assistant needs a couple details';
  return 'Contacting Home Assistant...';
}

function compactId(id: string) {
  if (!id) return '';
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function normalizeOptions(options: unknown): { value: string; label: string }[] {
  if (!Array.isArray(options)) return [];
  const result: { value: string; label: string }[] = [];
  for (const opt of options) {
    if (typeof opt === 'string' || typeof opt === 'number') {
      const val = String(opt);
      result.push({ value: val, label: val });
    } else if (opt && typeof opt === 'object') {
      const obj = opt as Record<string, unknown>;
      const value =
        typeof obj.value === 'string' || typeof obj.value === 'number'
          ? String(obj.value)
          : null;
      const label = typeof obj.label === 'string' ? obj.label : value;
      if (value) {
        result.push({ value, label: label ?? value });
      }
    }
  }
  return result;
}

function detectFieldType(field: Record<string, unknown>): SchemaField['type'] {
  const rawType = typeof field.type === 'string' ? field.type.toLowerCase() : '';
  if (rawType === 'boolean') return 'boolean';
  if (rawType === 'select') return 'select';
  if (rawType === 'password') return 'password';
  if (rawType === 'string') return 'string';

  const selector = field.selector && typeof field.selector === 'object' ? (field.selector as Record<string, unknown>) : null;
  if (selector?.boolean) return 'boolean';
  if (selector?.select) return 'select';
  if (selector && typeof selector.text === 'object') {
    const textSelector = selector.text as Record<string, unknown>;
    if (typeof textSelector.type === 'string' && textSelector.type.toLowerCase().includes('password')) {
      return 'password';
    }
  }
  return 'string';
}

function parseSchema(dataSchema: unknown): SchemaField[] {
  if (!Array.isArray(dataSchema)) return [];
  const fields: SchemaField[] = [];
  for (const rawField of dataSchema) {
    if (!rawField || typeof rawField !== 'object') continue;
    const field = rawField as Record<string, unknown>;
    const name = typeof field.name === 'string' ? field.name : null;
    if (!name) continue;
    const type = detectFieldType(field);
    const required = field.required === true;
    let optionsSource: unknown = null;
    if (type === 'select') {
      if (Array.isArray(field.options)) {
        optionsSource = field.options;
      } else if (field.selector && typeof field.selector === 'object') {
        const selectorObj = field.selector as Record<string, unknown>;
        const selectConfig =
          selectorObj.options ??
          (selectorObj.select && typeof selectorObj.select === 'object'
            ? (selectorObj.select as Record<string, unknown>).options
            : null);
        optionsSource = selectConfig;
      }
    }

    const options = type === 'select' ? normalizeOptions(optionsSource) : undefined;

    const defaultValue = field.default;
    fields.push({
      name,
      label: name.replace(/[_-]/g, ' '),
      required,
      type,
      options,
      defaultValue,
    });
  }
  return fields;
}

export default function DiscoveredDevices(props: Props) {
  const router = useRouter();
  const [selectedFlow, setSelectedFlow] = useState<DiscoveryFlow | null>(null);
  const [flows, setFlows] = useState<DiscoveryFlow[]>([]);
  const [flowsError, setFlowsError] = useState<string | null>(null);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [requestedArea, setRequestedArea] = useState<string>(props.areas[0] ?? '');
  const [requestedName, setRequestedName] = useState('');
  const [requestedDinodiaType, setRequestedDinodiaType] = useState<string | null>(null);
  const [requestedHaLabelId, setRequestedHaLabelId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [labels, setLabels] = useState<LabelOption[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>([]);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sortedCapabilityOptions = useMemo(
    () => [...props.capabilityOptions].sort((a, b) => a.localeCompare(b)),
    [props.capabilityOptions]
  );

  useEffect(() => {
    if (props.areas.length > 0 && !props.areas.includes(requestedArea)) {
      setRequestedArea(props.areas[0]);
    }
  }, [props.areas, requestedArea]);

  const resetSessionState = useCallback(() => {
    setSession(null);
    setWarnings([]);
    setActionError(null);
    setStepError(null);
    setSchemaFields([]);
    setFormValues({});
  }, []);

  const loadLabels = useCallback(async () => {
    setLabelsLoading(true);
    setLabelsError(null);
    try {
      const res = await fetch('/api/tenant/homeassistant/labels', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to load labels');
      }
      const list: LabelOption[] = Array.isArray(data?.labels) ? data.labels : [];
      setLabels(list);
    } catch (err) {
      setLabelsError(
        err instanceof Error ? err.message : 'Home Assistant labels are unavailable right now.'
      );
    } finally {
      setLabelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  const loadFlows = useCallback(async () => {
    setFlowsLoading(true);
    setFlowsError(null);
    try {
      const res = await fetch('/api/tenant/homeassistant/discovery', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to fetch discovered devices.');
      }
      setFlows(Array.isArray(data.flows) ? data.flows : []);
    } catch (err) {
      setFlowsError(
        err instanceof Error ? err.message : 'We could not reach Dinodia Hub for discovery.'
      );
    } finally {
      setFlowsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  const refreshSessionFromServer = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(`/api/tenant/discovery/sessions/${sessionId}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to refresh session.');
        }
        const nextSession = data.session as SessionPayload;
        setSession(nextSession);
        setWarnings((prev) => {
          const incoming: string[] = Array.isArray(data?.warnings) ? data.warnings : [];
          return [...prev, ...incoming];
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Unable to refresh session.');
      }
    },
    []
  );

  useEffect(() => {
    if (!session || session.isFinal) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    const shouldPoll =
      session.status === 'IN_PROGRESS' || session.lastHaStep?.type === 'progress';
    if (!shouldPoll) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void refreshSessionFromServer(session.id);
    }, 1800);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [session, refreshSessionFromServer]);

  useEffect(() => {
    if (session?.lastHaStep?.type === 'form') {
      const fields = parseSchema(session.lastHaStep.data_schema);
      setSchemaFields(fields);
      setFormValues((prev) => {
        const next = { ...prev };
        for (const field of fields) {
          if (next[field.name] === undefined) {
            if (field.defaultValue !== undefined) {
              next[field.name] = field.defaultValue;
            } else if (field.type === 'boolean') {
              next[field.name] = false;
            } else {
              next[field.name] = '';
            }
          }
        }
        return next;
      });
    } else {
      setSchemaFields([]);
    }
  }, [session?.lastHaStep]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleStart = async () => {
    if (!selectedFlow) return;
    setIsSubmitting(true);
    setActionError(null);
    setWarnings([]);
    setStepError(null);
    try {
      const res = await fetch('/api/tenant/discovery/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId: selectedFlow.flowId,
          requestedArea,
          requestedName: requestedName.trim() || null,
          requestedDinodiaType: requestedDinodiaType || null,
          requestedHaLabelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to start setup.');
      }
      const newSession = data.session as SessionPayload;
      setSession(newSession);
      setWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to start setup.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitStep = async () => {
    if (!session) return;
    const missing = schemaFields.filter((field) => {
      if (!field.required) return false;
      const value = formValues[field.name];
      if (field.type === 'boolean') return typeof value !== 'boolean';
      if (field.type === 'select') return !value;
      return typeof value !== 'string' || value.toString().trim().length === 0;
    });
    if (missing.length > 0) {
      setStepError('Please fill in all required fields.');
      return;
    }
    setIsSubmitting(true);
    setStepError(null);
    try {
      const res = await fetch(`/api/tenant/discovery/sessions/${session.id}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput: formValues }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.session) {
          setSession(data.session as SessionPayload);
        }
        throw new Error(data?.error || 'Unable to continue setup.');
      }
      const nextSession = data.session as SessionPayload;
      setSession(nextSession);
      setWarnings((prev) => [...prev, ...(Array.isArray(data?.warnings) ? data.warnings : [])]);
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Unable to continue setup.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!session) {
      setSelectedFlow(null);
      resetSessionState();
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await fetch(`/api/tenant/discovery/sessions/${session.id}/cancel`, { method: 'POST' });
      await refreshSessionFromServer(session.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to cancel setup.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderSchemaField = (field: SchemaField) => {
    const value = formValues[field.name];
    if (field.type === 'boolean') {
      return (
        <label key={field.name} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm">
          <span className="font-medium text-slate-800">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={Boolean(value)}
            onChange={(e) =>
              setFormValues((prev) => ({ ...prev, [field.name]: e.target.checked }))
            }
          />
        </label>
      );
    }

    if (field.type === 'select') {
      return (
        <label key={field.name} className="block text-sm">
          <span className="text-slate-700">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) =>
              setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
            }
          >
            <option value="">Select an option</option>
            {(field.options ?? []).map((opt, idx) => (
              <option key={`${field.name}-${idx}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return (
      <label key={field.name} className="block text-sm">
        <span className="text-slate-700">
          {field.label}
          {field.required ? ' *' : ''}
        </span>
        <input
          type={field.type === 'password' ? 'password' : 'text'}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          onChange={(e) =>
            setFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
          }
        />
      </label>
    );
  };

  const renderStep = () => {
    if (!session) return null;
    const step = session.lastHaStep;
    if (session.status === 'FAILED') {
      return (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {session.error || 'Setup failed. Please try again.'}
        </div>
      );
    }
    if (session.status === 'CANCELED') {
      return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          This setup was canceled.
        </div>
      );
    }

    if (!step || step.type === 'progress') {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" aria-hidden="true" />
          <span>Waiting for Home Assistant...</span>
        </div>
      );
    }

    if (step.type === 'form') {
      return (
        <div className="space-y-3 rounded-xl border border-slate-100 bg-white/80 p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">Home Assistant needs some details</p>
          {step.errors && Object.keys(step.errors).length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {Object.values(step.errors)
                .filter(Boolean)
                .join(', ')}
            </div>
          )}
          <div className="space-y-3">
            {schemaFields.length > 0 ? schemaFields.map((field) => renderSchemaField(field)) : (
              <p className="text-sm text-slate-600">No fields required for this step.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-3 pt-1 text-sm text-slate-600">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
              onClick={handleSubmitStep}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Continue'}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Sensitive details are sent directly to Home Assistant and not stored in Dinodia.
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-slate-100 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-sm">
        {buildStatusMessage(session)}
      </div>
    );
  };

  const handleDone = () => {
    router.push('/tenant/dashboard');
  };

  const emptyState = (
    <div className="flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 text-center">
      <div>
        <p className="font-semibold text-slate-800">No discovered devices right now</p>
        <p className="mt-1 text-sm text-slate-600">
          Make sure the device is powered on and on the same network, then hit refresh.
        </p>
      </div>
    </div>
  );

  const showSuccess = session?.status === 'SUCCEEDED';

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Devices</p>
          <h1 className="text-2xl font-semibold text-slate-900">Add Discovered Device</h1>
          <p className="text-sm text-slate-600">
            Pick a discovered device, assign it to a room, and Dinodia will finish setup.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/tenant/dashboard"
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          >
            ← Back to dashboard
          </Link>
          <button
            type="button"
            onClick={() => void loadFlows()}
            className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            disabled={flowsLoading}
          >
            {flowsLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Discovered on your network</h2>
            {flowsError && (
              <span className="text-sm text-red-700">{flowsError}</span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {flowsLoading && flows.length === 0 ? (
              <div className="flex h-full min-h-[140px] items-center justify-center rounded-2xl border border-slate-200 bg-white/70 px-6 text-sm text-slate-700 shadow-sm">
                Scanning for nearby devices...
              </div>
            ) : flows.length === 0 ? (
              emptyState
            ) : (
              flows.map((flow) => (
                <button
                  key={flow.flowId}
                  type="button"
                  onClick={() => {
                    setSelectedFlow(flow);
                    resetSessionState();
                    setRequestedName('');
                    setRequestedDinodiaType(null);
                    setRequestedHaLabelId(null);
                  }}
                  className={classNames(
                    'flex h-full flex-col items-start rounded-2xl border bg-white/80 p-4 text-left shadow-sm transition hover:-translate-y-[1px] hover:shadow-md',
                    selectedFlow?.flowId === flow.flowId
                      ? 'border-indigo-400 ring-2 ring-indigo-100'
                      : 'border-slate-200'
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <p className="text-base font-semibold text-slate-900">{flow.title}</p>
                    <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                      {flow.handler}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{flow.description}</p>
                  {flow.source && (
                    <span className="mt-3 inline-flex items-center rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700">
                      Source: {flow.source}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            {!selectedFlow && (
              <div className="space-y-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Choose a discovered device</p>
                <p>
                  Select a card to claim it. You can set the room, label, and device type before Dinodia finishes setup.
                </p>
              </div>
            )}
            {selectedFlow && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Selected</p>
                  <p className="text-lg font-semibold text-slate-900">{selectedFlow.title}</p>
                  <p className="text-sm text-slate-600">{selectedFlow.description}</p>
                </div>
                {!session && (
                  <div className="space-y-3 text-sm">
                    <label className="block">
                      <span className="text-slate-700">Area</span>
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none"
                        value={requestedArea}
                        onChange={(e) => setRequestedArea(e.target.value)}
                      >
                        {props.areas.map((area) => (
                          <option key={area} value={area}>
                            {area}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-700">Optional name</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none"
                        value={requestedName}
                        onChange={(e) => setRequestedName(e.target.value)}
                        placeholder="Living room TV"
                      />
                    </label>
                    <label className="block">
                      <span className="text-slate-700">Optional device type override</span>
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none"
                        value={requestedDinodiaType ?? ''}
                        onChange={(e) => setRequestedDinodiaType(e.target.value || null)}
                      >
                        <option value="">Auto-detect</option>
                        {sortedCapabilityOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-700">Optional Home Assistant label</span>
                      <select
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none"
                        value={requestedHaLabelId ?? ''}
                        onChange={(e) => setRequestedHaLabelId(e.target.value || null)}
                        disabled={labelsLoading}
                      >
                        <option value="">{labelsLoading ? 'Loading labels...' : 'No label'}</option>
                        {labels.map((label) => (
                          <option key={label.label_id} value={label.label_id}>
                            {label.name}
                          </option>
                        ))}
                      </select>
                      {labelsError && <p className="mt-1 text-xs text-amber-700">{labelsError}</p>}
                    </label>
                    {actionError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {actionError}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 pt-1">
                      <button
                        type="button"
                        className="inline-flex flex-1 items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                        onClick={handleStart}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? 'Starting...' : 'Continue'}
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={handleCancel}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {session && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</p>
                      <p className="text-sm font-semibold text-slate-900">{buildStatusMessage(session)}</p>
                    </div>
                    {stepError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        {stepError}
                      </div>
                    )}
                    {warnings.length > 0 && (
                      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {warnings.map((w, idx) => (
                          <p key={`${w}-${idx}`}>{w}</p>
                        ))}
                      </div>
                    )}
                    {showSuccess && (
                      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <p className="font-semibold">Device added</p>
                        <ul className="space-y-1">
                          {session.newDeviceIds.length > 0 && (
                            <li>Devices: {session.newDeviceIds.map(compactId).join(', ')}</li>
                          )}
                          {session.newEntityIds.length > 0 && (
                            <li>Entities: {session.newEntityIds.map(compactId).join(', ')}</li>
                          )}
                          <li>Area: {session.requestedArea}</li>
                          {session.requestedHaLabelId && <li>HA label applied.</li>}
                          {session.requestedDinodiaType && (
                            <li>Type override: {session.requestedDinodiaType}</li>
                          )}
                        </ul>
                        <div className="flex flex-wrap gap-3 pt-1">
                          <button
                            type="button"
                            className="inline-flex flex-1 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white shadow-sm hover:bg-slate-800"
                            onClick={handleDone}
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                              setSelectedFlow(null);
                              resetSessionState();
                              void loadFlows();
                            }}
                          >
                            Add another
                          </button>
                        </div>
                      </div>
                    )}
                    {!showSuccess && renderStep()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
