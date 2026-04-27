'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { platformFetch } from '@/lib/platformFetchClient';
import { logout as performLogout } from '@/lib/logout';
import { LineAreaChart, TrendPoint } from './charts/LineAreaChart';

type HistoryBucket = 'daily' | 'weekly' | 'monthly';
type Preset = '7' | '30' | '90' | 'all' | 'custom';

type SummaryPoint = { bucketStart: string; label: string; totalKwhDelta: number };
type SummaryCostPoint = { bucketStart: string; label: string; estimatedCost: number };
type SummaryEntity = { entityId: string; name?: string; totalKwhDelta: number; estimatedCost?: number; area?: string | null };
type SummaryArea = { area: string; totalKwhDelta: number; estimatedCost?: number; topEntities: SummaryEntity[] };
type BatteryRow = { entityId: string; name?: string; latestBatteryPercent: number; capturedAt: string };
type BatteryPoint = { bucketStart: string; label: string; avgPercent: number; count: number };
type EntityOption = { entityId: string; name: string; area: string; lastCapturedAt: string };

type SummaryResponse = {
  ok: boolean;
  bucket: HistoryBucket;
  range: { from: string; to: string };
  lastSnapshotAt: string | null;
  pricePerKwh: number | null;
  coverage: { entitiesWithReadings: number; entitiesMonitored: number };
  seriesTotalKwh: SummaryPoint[];
  seriesTotalCost: SummaryCostPoint[];
  seriesBatteryAvgPercent: BatteryPoint[];
  topEntities: SummaryEntity[];
  byArea: SummaryArea[];
  batteryLow: BatteryRow[];
};

type Props = { username?: string };

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return 'Not available';
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const dateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const numberFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const costFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });

type SelectOption = { id: string; label: string; hint?: string };

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: SelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };
  return (
    <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {selected.map((s) => {
          const match = options.find((o) => o.id === s);
          const chipLabel = match?.label || s;
          const chipHint = match?.hint || s;
          return (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
          >
            <span className="font-semibold">{chipLabel}</span>
            <span className="text-white/70">({chipHint})</span>
            <span className="font-semibold">×</span>
          </button>
          );
        })}
        {selected.length === 0 && <span className="text-xs text-slate-500">{placeholder || 'All'}</span>}
      </div>
      <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-100 bg-white">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <label key={opt.id} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4" checked={isSelected} onChange={() => toggle(opt.id)} />
              <div className="truncate">
                <div className="font-medium text-slate-900">{opt.label}</div>
                {opt.hint && <div className="text-[11px] font-mono text-slate-500">{opt.hint}</div>}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminDashboard({ username }: Props) {
  void username; // Provided by page for consistency; not required in observe-only UI.
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<HistoryBucket>('daily');
  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [energyEntities, setEnergyEntities] = useState<EntityOption[]>([]);
  const [batteryEntities, setBatteryEntities] = useState<EntityOption[]>([]);
  const [selectedEnergyEntities, setSelectedEnergyEntities] = useState<string[]>([]);
  const [selectedBatteryEntities, setSelectedBatteryEntities] = useState<string[]>([]);
  const [selectorsError, setSelectorsError] = useState<string | null>(null);
  const energyScrollRef = useRef<HTMLDivElement | null>(null);
  const batteryScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (preset !== 'custom') return;
    if (from && to) return;
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    setFrom(dateOnly(weekAgo));
    setTo(dateOnly(today));
  }, [preset, from, to]);

  const totalKwh = useMemo(() => {
    if (summary?.byArea?.length) {
      return summary.byArea
        .filter((a) => (a.area || '').toLowerCase() !== 'unassigned')
        .reduce((sum, a) => sum + (a.totalKwhDelta || 0), 0);
    }
    return (summary?.seriesTotalKwh ?? []).reduce((sum, p) => sum + (p.totalKwhDelta || 0), 0);
  }, [summary]);
  const totalCost = useMemo(() => {
    if (!summary || summary.pricePerKwh == null) return null;
    return summary.seriesTotalCost.reduce((sum, p) => sum + (p.estimatedCost || 0), 0);
  }, [summary]);

  const energyTrendPoints: TrendPoint[] = useMemo(
    () =>
      (summary?.seriesTotalKwh ?? []).map((p) => ({
        date: new Date(p.bucketStart),
        label: p.label,
        value: p.totalKwhDelta ?? 0,
      })),
    [summary]
  );

  const batteryTrendPoints: TrendPoint[] = useMemo(
    () =>
      (summary?.seriesBatteryAvgPercent ?? []).map((p) => ({
        date: new Date(p.bucketStart),
        label: p.label,
        value: p.avgPercent ?? 0,
      })),
    [summary]
  );

  useEffect(() => {
    const el = energyScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [energyTrendPoints, bucket]);

  useEffect(() => {
    const el = batteryScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [batteryTrendPoints, bucket]);

  const energyVariant = 'line';

  // Coverage removed from UI; metric no longer used

  const batteryLowCount = summary?.batteryLow.length ?? 0;

  const buildParams = () => {
    const params = new URLSearchParams();
    params.set('bucket', bucket);
    if (preset === 'all') {
      params.set('days', 'all');
    } else if (preset === 'custom') {
      params.set('from', from);
      params.set('to', to);
    } else {
      params.set('days', preset);
    }
    selectedAreas.forEach((a) => params.append('areas', a));
    selectedEnergyEntities.forEach((e) => params.append('energyEntityIds', e));
    selectedBatteryEntities.forEach((e) => params.append('batteryEntityIds', e));
    return params.toString();
  };

  const buildSelectorParams = useCallback(() => {
    const params = new URLSearchParams();
    if (preset === 'all') {
      params.set('days', 'all');
    } else if (preset === 'custom') {
      params.set('from', from);
      params.set('to', to);
    } else {
      params.set('days', preset);
    }
    selectedAreas.forEach((a) => params.append('areas', a));
    return params.toString();
  }, [preset, from, to, selectedAreas]);

  const loadSummary = async () => {
    if (preset === 'custom' && (!from || !to)) {
      setError('Choose both from/to dates for a custom range.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await platformFetch(`/api/admin/monitoring/summary?${buildParams()}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => null)) as (SummaryResponse & { error?: string }) | null;
      if (!res.ok || !data?.ok) {
        const message =
          data && typeof data.error === 'string' && data.error.length > 0 ? data.error : 'Unable to load analytics right now.';
        throw new Error(message);
      }
      setSummary(data);
      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      console.error('Failed to load summary', err);
      setError((err as Error).message || 'Unable to load analytics right now.');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const loadSelectors = useCallback(async () => {
    try {
      setSelectorsError(null);
      const [areasRes, entitiesRes] = await Promise.all([
        platformFetch('/api/admin/areas', { cache: 'no-store', credentials: 'include' }),
        platformFetch(`/api/admin/monitoring/entities?${buildSelectorParams()}`, { cache: 'no-store', credentials: 'include' }),
      ]);
      const areasData = await areasRes.json().catch(() => ({}));
      const entitiesData = await entitiesRes.json().catch(() => ({}));
      if (!areasRes.ok) throw new Error(areasData.error || 'Unable to load areas.');
      if (!entitiesRes.ok) throw new Error(entitiesData.error || 'Unable to load entities.');
      const areaList: string[] = Array.isArray(areasData.areas)
        ? Array.from(
            new Set(
              areasData.areas
                .filter((a: unknown): a is string => typeof a === 'string')
                .map((a: string) => a.trim())
                .filter((a: string) => a.length > 0 && a.toLowerCase() !== 'unassigned')
            )
          )
        : [];
      setAreas(areaList.sort((a, b) => a.localeCompare(b)) as string[]);
      const energyList = Array.isArray(entitiesData.energyEntities) ? entitiesData.energyEntities : [];
      const batteryList = Array.isArray(entitiesData.batteryEntities) ? entitiesData.batteryEntities : [];
      setEnergyEntities(energyList.filter((e: EntityOption) => (e.area || '').toLowerCase() !== 'unassigned'));
      setBatteryEntities(batteryList.filter((e: EntityOption) => (e.area || '').toLowerCase() !== 'unassigned'));

      const energyIds = new Set(energyList.map((e: EntityOption) => e.entityId));
      const batteryIds = new Set(batteryList.map((e: EntityOption) => e.entityId));
      setSelectedEnergyEntities((prev) => prev.filter((id) => energyIds.has(id)));
      setSelectedBatteryEntities((prev) => prev.filter((id) => batteryIds.has(id)));
    } catch (err) {
      console.error('Failed to load selectors', err);
      setSelectorsError((err as Error).message || 'Unable to load filters.');
    }
  }, [buildSelectorParams]);

  useEffect(() => {
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, preset, from, to, selectedAreas, selectedEnergyEntities, selectedBatteryEntities]);

  useEffect(() => {
    if (preset === 'custom' && (!from || !to)) return;
    void loadSelectors();
  }, [preset, from, to, selectedAreas, loadSelectors]);

  const lastSnapshotDisplay = summary ? formatDateTime(summary.lastSnapshotAt) : 'Not available';
  const lastFetchedDisplay = lastFetchedAt ? formatDateTime(lastFetchedAt) : 'Never';

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-3 pb-16 pt-8 sm:px-4 lg:pt-12">
        <header className="sticky top-4 z-30 flex flex-col gap-3 rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:rounded-full sm:px-6 sm:py-2.5">
          <div className="flex items-start gap-3 sm:items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/60 bg-white shadow-sm">
              <Image src="/brand/logo-mark.png" alt="Dinodia" width={40} height={40} priority />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Admin analytics</p>
              <p className="text-base font-semibold text-slate-900">Homeowner Energy Monitoring Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs leading-tight text-slate-500">
              <p className="font-semibold text-slate-700">Last snapshot</p>
              <p>{lastSnapshotDisplay}</p>
            </div>
            <div className="relative">
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
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-100 bg-white/95 p-1 text-sm text-slate-700 shadow-lg backdrop-blur">
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    Homeowner Dashboard
                  </Link>
                  <Link
                    href="/admin/settings"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    Account Settings
                  </Link>
                  <Link
                    href="/admin/manage-devices"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    Home Devices
                  </Link>
                  <Link
                    href="/admin/manage-users"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                    onClick={() => setMenuOpen(false)}
                  >
                    User Management
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
        </header>

        <section className="rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Range</span>
              {(['7', '30', '90', 'all'] as Preset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                    preset === p ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p === 'all' ? 'All time' : `${p}d`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPreset('custom')}
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                  preset === 'custom' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Custom
              </button>
            </div>
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">From</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">To</span>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1"
                  />
                </label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Bucket</span>
              <select
                value={bucket}
                onChange={(e) => setBucket(e.target.value as HistoryBucket)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadSummary()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
              >
                {loading && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-white" />}
                Refresh
              </button>
              <p className="text-xs text-slate-500">Last refresh: {lastFetchedDisplay}</p>
            </div>
          </div>
          {error && (
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
          {selectorsError && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {selectorsError}
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <MultiSelect
            label="Areas"
            options={areas.map((a) => ({ id: a, label: a, hint: a }))}
            selected={selectedAreas}
            onChange={setSelectedAreas}
            placeholder="All areas"
          />
          <MultiSelect
            label="Energy entities"
            options={energyEntities.map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
            selected={selectedEnergyEntities}
            onChange={setSelectedEnergyEntities}
            placeholder="All energy entities"
          />
          <MultiSelect
            label="Battery entities"
            options={batteryEntities.map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
            selected={selectedBatteryEntities}
            onChange={setSelectedBatteryEntities}
            placeholder="All battery entities"
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Total energy</p>
            <p className="text-2xl font-semibold text-slate-900">{numberFmt.format(totalKwh)} kWh</p>
            <p className="text-xs text-slate-500">{summary ? `${formatDateTime(summary.range.from)} → ${formatDateTime(summary.range.to)}` : ''}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Estimated cost</p>
            <p className="text-2xl font-semibold text-slate-900">{totalCost != null ? costFmt.format(totalCost) : 'Price not set'}</p>
            <p className="text-xs text-slate-500">
              {summary?.pricePerKwh != null ? `Price £${summary.pricePerKwh}/kWh` : 'Set ELECTRICITY_PRICE_PER_KWH'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Low battery</p>
            <p className="text-2xl font-semibold text-slate-900">{batteryLowCount}</p>
            <p className="text-xs text-slate-500">Below 25%</p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Energy trend</h2>
            <span className="text-xs text-slate-500">
              Bucket: {bucket}, points: {summary?.seriesTotalKwh.length ?? 0}
            </span>
          </div>
          <div
            ref={energyScrollRef}
            className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm"
          >
            <div
              className="min-w-[900px]"
              style={{ minWidth: `${Math.max(900, energyTrendPoints.length * 32)}px` }}
            >
              <LineAreaChart
                id="energy-trend"
                title="Energy"
                points={energyTrendPoints}
                color="#0ea5e9"
                gradientTo="#5ac8fa"
                valueUnit="kWh"
                variant={energyVariant}
                emptyLabel="No energy readings in this window."
                formatValue={(v) => Number(v).toFixed(2)}
                forcedWidth={Math.max(900, energyTrendPoints.length * 32)}
              />
            </div>
          </div>
          {summary?.seriesTotalCost?.length ? (
            <div className="mt-2 text-sm text-slate-600">Cost trend mirrors energy using configured £/kWh.</div>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Battery trend</h2>
            <span className="text-xs text-slate-500">
              Bucket: {bucket}, points: {summary?.seriesBatteryAvgPercent.length ?? 0}
            </span>
          </div>
          <div
            ref={batteryScrollRef}
            className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm"
          >
            <div
              className="min-w-[900px]"
              style={{ minWidth: `${Math.max(900, batteryTrendPoints.length * 32)}px` }}
            >
              <LineAreaChart
                id="battery-trend"
                title="Battery"
                points={batteryTrendPoints}
                color="#34c759"
                gradientTo="#a3e635"
                valueUnit="%"
                variant={energyVariant}
                emptyLabel="No battery readings in this window."
                formatValue={(v) => v.toFixed(0)}
                forcedWidth={Math.max(900, batteryTrendPoints.length * 32)}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">Average of latest battery % per entity per bucket.</p>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Top entities (overall)</h3>
              <span className="text-xs text-slate-500">Top 20 by kWh</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Entity</th>
                    <th className="px-3 py-2 text-left">Area</th>
                    <th className="px-3 py-2 text-right">kWh</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.topEntities ?? [])
                    .filter((row) => (row.area || '').toLowerCase() !== 'unassigned')
                    .map((row) => (
                    <tr key={row.entityId} className="odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{row.name || row.entityId}</div>
                        <div className="font-mono text-[11px] text-slate-500">{row.entityId}</div>
                      </td>
                      <td className="px-3 py-2">{row.area ?? 'Unassigned'}</td>
                      <td className="px-3 py-2 text-right">{row.totalKwhDelta.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{row.estimatedCost != null ? costFmt.format(row.estimatedCost) : '—'}</td>
                    </tr>
                  ))}
                  {(summary?.topEntities?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                        No energy readings in this window.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">By area</h3>
              <span className="text-xs text-slate-500">Top 30 areas, 10 entities each</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Area</th>
                    <th className="px-3 py-2 text-right">kWh</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-left">Top entities</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.byArea ?? [])
                    .filter((row) => (row.area || '').toLowerCase() !== 'unassigned')
                    .map((row) => (
                    <tr key={row.area} className="odd:bg-white even:bg-slate-50/60">
                      <td className="px-3 py-2">{row.area}</td>
                      <td className="px-3 py-2 text-right">{row.totalKwhDelta.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{row.estimatedCost != null ? costFmt.format(row.estimatedCost) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {row.topEntities.length === 0
                          ? '—'
                          : row.topEntities
                              .slice(0, 3)
                              .map((e) => `${e.entityId} (${e.totalKwhDelta.toFixed(1)} kWh)`)
                              .join(', ')}
                      </td>
                    </tr>
                  ))}
                  {(summary?.byArea?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                        No area data yet (assign areas to reduce Unassigned).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Battery health</h3>
            <span className="text-xs text-slate-500">Latest values per entity</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="w-full text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Entity</th>
                  <th className="px-3 py-2 text-left">Percent</th>
                  <th className="px-3 py-2 text-left">Captured at (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.batteryLow ?? []).map((row) => (
                  <tr key={row.entityId} className="odd:bg-white even:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs">{row.entityId}</td>
                    <td className="px-3 py-2 text-red-600 font-semibold">{row.latestBatteryPercent}%</td>
                    <td className="px-3 py-2 text-slate-600">{new Date(row.capturedAt).toLocaleString('en-GB', { timeZone: 'UTC' })}</td>
                  </tr>
                ))}
                {(summary?.batteryLow?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                      No batteries below 25% in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Battery entities are detected by unit % and an entity id containing “battery”. Threshold fixed at 25%.</p>
        </section>
      </div>
    </div>
  );
}
