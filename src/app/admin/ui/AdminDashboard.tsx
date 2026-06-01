'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { platformFetch } from '@/lib/platformFetchClient';
import { logout as performLogout } from '@/lib/logout';
import { friendlyUnknownError } from '@/lib/clientError';
import { MultiLineChart, MultiSeriesTrend } from './charts/LineAreaChart';
import { BoilerTemperatureBandChart } from './charts/BoilerCharts';
import { MetricPoint, MetricSeries, MetricGroupedBarChart, MetricTotalsBarChart } from './charts/HeatingTotalsCharts';

type HistoryBucket = 'daily' | 'weekly' | 'monthly';
type Preset = '7' | '30' | '90' | 'all' | 'custom';

type SummaryPoint = { bucketStart: string; label: string; totalKwhDelta: number };
type SummaryCostPoint = { bucketStart: string; label: string; estimatedCost: number };
type SummaryEntity = { entityId: string; name?: string; label?: string | null; totalKwhDelta: number; estimatedCost?: number; area?: string | null };
type SummaryArea = { area: string; totalKwhDelta: number; estimatedCost?: number; topEntities: SummaryEntity[] };
type BatteryRow = { entityId: string; name?: string; label?: string | null; latestBatteryPercent: number; capturedAt: string };
type BatteryLatestRow = { entityId: string; name?: string; label?: string | null; area?: string | null; latestBatteryPercent: number; capturedAt: string };
type BatteryPoint = { bucketStart: string; label: string; avgPercent: number; count: number };
type SummaryAreaSeries = { area: string; points: SummaryPoint[] };
type BatteryEntitySeries = { entityId: string; name?: string; label?: string | null; points: Array<{ bucketStart: string; label: string; avgPercent: number }> };
type EntityOption = { entityId: string; name: string; area: string; label?: string | null; lastCapturedAt: string };
type BoilerHistoryPoint = { bucketStart: string; label: string; value: number };
type BoilerTemperaturePoint = {
  bucketStart: string;
  label: string;
  currentTemperature: number;
  targetTemperature: number | null;
};
type BoilerHeatingPoint = { bucketStart: string; label: string; state: number | null };
type BoilerEntitySeries = { entityId: string; name: string; area: string; points: BoilerHistoryPoint[] };
type BoilerTemperatureSeries = { entityId: string; name: string; area: string; points: BoilerTemperaturePoint[] };
type BoilerHeatingSeries = { entityId: string; name: string; area: string; points: BoilerHeatingPoint[] };

type SummaryResponse = {
  ok: boolean;
  bucket: HistoryBucket;
  range: { from: string; to: string };
  lastSnapshotAt: string | null;
  pricePerKwh: number | null;
  coverage: { entitiesWithReadings: number; entitiesMonitored: number };
  seriesTotalKwh: SummaryPoint[];
  seriesKwhByArea: SummaryAreaSeries[];
  seriesTotalCost: SummaryCostPoint[];
  seriesBatteryAvgPercent: BatteryPoint[];
  seriesBatteryByEntity: BatteryEntitySeries[];
  topEntities: SummaryEntity[];
  byArea: SummaryArea[];
  batteryLow: BatteryRow[];
  batteryLatestByEntity?: BatteryLatestRow[];
};
type BoilerHistoryResponse = {
  ok: boolean;
  unit: string;
  points: BoilerHistoryPoint[];
  seriesByArea?: Array<{ area: string; points: BoilerHistoryPoint[] }>;
  seriesByEntity?: BoilerEntitySeries[];
  seriesTemperatureByEntity?: BoilerTemperatureSeries[];
  seriesHeatingStateByEntity?: BoilerHeatingSeries[];
  meta?: {
    label?: string | null;
    labelFilterDegraded?: boolean;
    toleranceC?: number;
    bucketHours?: number;
    boilerPowerKw?: number | null;
    pricePerKwh?: number | null;
    estimatedOnHours?: number | null;
    estimatedKwh?: number | null;
    estimatedCost?: number | null;
  };
  error?: string;
};

type HeatingUsageHistoryPoint = {
  ts: string;
  label?: string;
  onMinutes?: number | null;
  offMinutes?: number | null;
  unknownMinutes?: number | null;
  value?: number | null;
};
type HeatingUsageHistorySeries = {
  entityId: string;
  name: string;
  area: string | null;
  label?: string | null;
  points: HeatingUsageHistoryPoint[];
};
type HeatingUsageHistoryResponse = {
  ok: boolean;
  unit: string;
  metric?: string;
  seriesByEntity: HeatingUsageHistorySeries[];
  error?: string;
};

type EnergyByEntityPoint = { bucketStart: string; label: string; totalKwhDelta: number };
type EnergyByEntitySeries = {
  entityId: string;
  name: string;
  label?: string | null;
  area?: string | null;
  totalKwhDelta: number;
  points: EnergyByEntityPoint[];
};
type EnergyByEntityResponse = {
  ok: boolean;
  bucket: HistoryBucket;
  range: { from: string; to: string };
  seriesByEntity: EnergyByEntitySeries[];
  error?: string;
};

type Props = { username?: string };
type HubStatusPoint = { ts: string; hubOnline: boolean };
type HubStatusResponse = { ok: boolean; range?: { from: string; to: string }; points: HubStatusPoint[]; error?: string };

type EnergyTab = 'gas' | 'electric';

const isGasLabel = (label: string | null | undefined) => {
  const normalized = (label ?? '').trim().toLowerCase();
  return normalized === 'boiler' || normalized === 'radiator';
};

type GasTopEntity = { entityId: string; name: string; area: string | null; label: string | null; totalKwh: number; totalCost: number | null };

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

const formatSnapshotLabel = (date: Date) =>
  date.toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const dateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const numberFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const costFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });
const chartPalette = ['#0ea5e9', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#5ac8fa', '#5856d6', '#30d158', '#ff2d55', '#ffd60a'];

type SelectOption = { id: string; label: string; hint?: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDayUtc = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const endOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

const sumMetricPoints = (points: MetricPoint[]) => (points ?? []).reduce((sum, p) => sum + (typeof p?.value === 'number' && Number.isFinite(p.value) ? p.value : 0), 0);

const parseDateOnlyUtc = (value: string, endOfDay = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map((v) => Number(v));
  const date = endOfDay ? endOfDayUtc(new Date(Date.UTC(y, m - 1, d))) : startOfDayUtc(new Date(Date.UTC(y, m - 1, d)));
  return Number.isNaN(date.getTime()) ? null : date;
};

const getIsoWeekInfoUtc = (date: Date) => {
  const temp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const weekStart = new Date(Date.UTC(temp.getUTCFullYear(), temp.getUTCMonth(), temp.getUTCDate()));
  const weekStartDay = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStartDay - 1));

  return { year: temp.getUTCFullYear(), week, weekStart };
};

const formatDateUtc = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getBucketInfoUtc = (bucket: HistoryBucket, capturedAt: Date) => {
  if (bucket === 'weekly') {
    const { year, week, weekStart } = getIsoWeekInfoUtc(capturedAt);
    return {
      key: `${year}-W${String(week).padStart(2, '0')}`,
      bucketStart: new Date(weekStart),
      label: `Week of ${formatDateUtc(new Date(weekStart))}`,
    };
  }

  if (bucket === 'monthly') {
    const start = new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), 1));
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      bucketStart: start,
      label: `${monthNames[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    };
  }

  const start = startOfDayUtc(capturedAt);
  return { key: formatDateUtc(start), bucketStart: start, label: formatDateUtc(start) };
};

type TimeRange = { start: Date; end: Date };

function computeOfflineRanges(points: HubStatusPoint[], window: { from: Date; to: Date }): TimeRange[] {
  const ordered = (points ?? [])
    .map((p) => ({ date: new Date(p.ts), hubOnline: p.hubOnline === true }))
    .filter((p) => Number.isFinite(p.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const out: TimeRange[] = [];
  let offlineStart: Date | null = null;

  for (const p of ordered) {
    if (!p.hubOnline) {
      offlineStart = p.date;
      continue;
    }
    if (offlineStart) {
      const start = new Date(Math.max(offlineStart.getTime(), window.from.getTime()));
      const end = new Date(Math.min(p.date.getTime(), window.to.getTime()));
      if (end.getTime() > start.getTime()) out.push({ start, end });
      offlineStart = null;
    }
  }

  if (offlineStart) {
    const start = new Date(Math.max(offlineStart.getTime(), window.from.getTime()));
    const end = window.to;
    if (end.getTime() > start.getTime()) out.push({ start, end });
  }

  // Merge overlaps (defensive).
  const merged: TimeRange[] = [];
  for (const r of out.sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const last = merged[merged.length - 1];
    if (!last) merged.push(r);
    else if (r.start.getTime() <= last.end.getTime()) {
      last.end = new Date(Math.max(last.end.getTime(), r.end.getTime()));
    } else {
      merged.push(r);
    }
  }
  return merged;
}

const aggregateKwhPoints = (points: SummaryPoint[], bucket: HistoryBucket) => {
  const buckets = new Map<string, { bucketStart: Date; label: string; total: number }>();
  for (const point of points) {
    const date = new Date(point.bucketStart);
    if (Number.isNaN(date.getTime())) continue;
    const info = getBucketInfoUtc(bucket, date);
    const existing = buckets.get(info.key);
    if (!existing) {
      buckets.set(info.key, { bucketStart: info.bucketStart, label: info.label, total: point.totalKwhDelta || 0 });
    } else {
      existing.total += point.totalKwhDelta || 0;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((entry) => ({
      bucketStart: entry.bucketStart.toISOString(),
      label: entry.label,
      totalKwhDelta: entry.total,
    }));
};

const aggregateBatteryAvgPoints = (points: BatteryPoint[], bucket: HistoryBucket) => {
  const buckets = new Map<string, { bucketStart: Date; label: string; sum: number; count: number }>();
  for (const point of points) {
    const date = new Date(point.bucketStart);
    if (Number.isNaN(date.getTime())) continue;
    const info = getBucketInfoUtc(bucket, date);
    const existing = buckets.get(info.key);
    const weighted = (point.avgPercent || 0) * (point.count || 0);
    if (!existing) {
      buckets.set(info.key, { bucketStart: info.bucketStart, label: info.label, sum: weighted, count: point.count || 0 });
    } else {
      existing.sum += weighted;
      existing.count += point.count || 0;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((entry) => ({
      bucketStart: entry.bucketStart.toISOString(),
      label: entry.label,
      avgPercent: entry.count > 0 ? entry.sum / entry.count : 0,
      count: entry.count,
    }));
};

const aggregateBatteryEntityPoints = (points: Array<{ bucketStart: string; label: string; avgPercent: number }>, bucket: HistoryBucket) => {
  const buckets = new Map<string, { bucketStart: Date; label: string; sum: number; count: number }>();
  for (const point of points) {
    const date = new Date(point.bucketStart);
    if (Number.isNaN(date.getTime())) continue;
    const info = getBucketInfoUtc(bucket, date);
    const existing = buckets.get(info.key);
    if (!existing) {
      buckets.set(info.key, { bucketStart: info.bucketStart, label: info.label, sum: point.avgPercent || 0, count: 1 });
    } else {
      existing.sum += point.avgPercent || 0;
      existing.count += 1;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
    .map((entry) => ({
      bucketStart: entry.bucketStart.toISOString(),
      label: entry.label,
      avgPercent: entry.count > 0 ? entry.sum / entry.count : 0,
    }));
};

const stableColorById = (id: string) => {
  const hash = id.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0);
  return chartPalette[Math.abs(hash) % chartPalette.length];
};

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
  const [summaryAllDaily, setSummaryAllDaily] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [energyTab, setEnergyTab] = useState<EnergyTab>('electric');
  const [bucket, setBucket] = useState<HistoryBucket>('daily');
  const [preset, setPreset] = useState<Preset>('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [hubStatusPoints, setHubStatusPoints] = useState<HubStatusPoint[]>([]);
  const [hubStatusError, setHubStatusError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [selectorsLoaded, setSelectorsLoaded] = useState(false);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [energyEntities, setEnergyEntities] = useState<EntityOption[]>([]);
  const [batteryEntities, setBatteryEntities] = useState<EntityOption[]>([]);
  const [radiatorEntities, setRadiatorEntities] = useState<EntityOption[]>([]);
  const [boilerEntities, setBoilerEntities] = useState<EntityOption[]>([]);
  const [selectedEnergyEntities, setSelectedEnergyEntities] = useState<string[]>([]);
  const [selectedBatteryEntities, setSelectedBatteryEntities] = useState<string[]>([]);
  const [selectedRadiatorEntities, setSelectedRadiatorEntities] = useState<string[]>([]);
  const [selectedBoilerEntities, setSelectedBoilerEntities] = useState<string[]>([]);
  const [radiatorTemperatureSeriesAll, setRadiatorTemperatureSeriesAll] = useState<BoilerTemperatureSeries[]>([]);
  const [boilerUsageMinutesTotals, setBoilerUsageMinutesTotals] = useState<MetricPoint[]>([]);
  const [radiatorUsageMinutesTotals, setRadiatorUsageMinutesTotals] = useState<MetricPoint[]>([]);
  const [radiatorUsageMinutesByEntity, setRadiatorUsageMinutesByEntity] = useState<MetricSeries[]>([]);
  const [boilerUsageKwhTotals, setBoilerUsageKwhTotals] = useState<MetricPoint[]>([]);
  const [radiatorUsageKwhTotals, setRadiatorUsageKwhTotals] = useState<MetricPoint[]>([]);
  const [radiatorUsageKwhByEntity, setRadiatorUsageKwhByEntity] = useState<MetricSeries[]>([]);
  const [boilerCostTotals, setBoilerCostTotals] = useState<MetricPoint[]>([]);
  const [radiatorCostTotals, setRadiatorCostTotals] = useState<MetricPoint[]>([]);
  const [radiatorCostByEntity, setRadiatorCostByEntity] = useState<MetricSeries[]>([]);
  const [gasTopEntities, setGasTopEntities] = useState<GasTopEntity[]>([]);
  const [electricEnergyByEntity, setElectricEnergyByEntity] = useState<EnergyByEntitySeries[]>([]);
  const [electricEnergyLoading, setElectricEnergyLoading] = useState(false);
  const [electricEnergyError, setElectricEnergyError] = useState<string | null>(null);
  const [boilerLoading, setBoilerLoading] = useState(false);
  const [boilerError, setBoilerError] = useState<string | null>(null);
  const [selectorsError, setSelectorsError] = useState<string | null>(null);
  // Charts are observe-only; keep UI stable across hover/scroll.

  useEffect(() => {
    if (preset !== 'custom') return;
    if (from && to) return;
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    setFrom(dateOnly(weekAgo));
    setTo(dateOnly(today));
  }, [preset, from, to]);

  useEffect(() => {
    // Entity selectors are per-tab; avoid cross-tab selection hiding all results.
    setSelectedEnergyEntities([]);
    setSelectedBatteryEntities([]);
  }, [energyTab]);

  const energyEntityAreaMap = useMemo(() => new Map(energyEntities.map((e) => [e.entityId, e.area])), [energyEntities]);
  const batteryEntityAreaMap = useMemo(() => new Map(batteryEntities.map((e) => [e.entityId, e.area])), [batteryEntities]);
  const gasEntityIds = useMemo(() => {
    const ids = new Set<string>();
    radiatorEntities.forEach((e) => ids.add(e.entityId));
    boilerEntities.forEach((e) => ids.add(e.entityId));
    return ids;
  }, [radiatorEntities, boilerEntities]);
  const rangeState = useMemo(() => {
    if (preset === 'all') {
      return { window: null as { from: Date; to: Date } | null, error: null as string | null };
    }

    if (preset === 'custom') {
      if (!from || !to) {
        return { window: null, error: 'Choose both from/to dates for a custom range.' };
      }
      const fromDate = parseDateOnlyUtc(from, false);
      const toDate = parseDateOnlyUtc(to, true);
      if (!fromDate || !toDate) {
        return { window: null, error: 'Please use a valid date range in YYYY-MM-DD format.' };
      }
      if (toDate.getTime() < fromDate.getTime()) {
        return { window: null, error: 'From must be on or before to.' };
      }
      return { window: { from: fromDate, to: toDate }, error: null };
    }

    const days = Number.parseInt(preset, 10);
    if (!Number.isFinite(days) || days <= 0) {
      return { window: null, error: null };
    }
    const toDate = endOfDayUtc(new Date());
    const fromDate = startOfDayUtc(new Date(toDate.getTime() - (days - 1) * MS_PER_DAY));
    return { window: { from: fromDate, to: toDate }, error: null };
  }, [preset, from, to]);
  const rangeError = rangeState.error;

  const summary = useMemo(() => {
    if (!summaryAllDaily) return null;
    const hasAreaFilter = selectedAreas.length > 0;
    const areaSet = new Set(selectedAreas);
    const energySet = new Set(selectedEnergyEntities);
    const batterySet = new Set(selectedBatteryEntities);
    const rangeWindow = rangeState.window;
    const rangeReady = preset !== 'custom' || (from && to);
    const inRange = (iso: string) => {
      if (!rangeWindow || !rangeReady) return true;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return false;
      return date >= rangeWindow.from && date <= rangeWindow.to;
    };

    const matchesArea = (area?: string | null) => !hasAreaFilter || (area ? areaSet.has(area) : false);
    const matchesEnergyEntity = (entityId: string, area?: string | null) => {
      if (selectedEnergyEntities.length > 0 && !energySet.has(entityId)) return false;
      if (!hasAreaFilter) return true;
      const resolvedArea = area ?? energyEntityAreaMap.get(entityId);
      return resolvedArea ? areaSet.has(resolvedArea) : false;
    };
    const matchesBatteryEntity = (entityId: string) => {
      if (selectedBatteryEntities.length > 0 && !batterySet.has(entityId)) return false;
      if (!hasAreaFilter) return true;
      const resolvedArea = batteryEntityAreaMap.get(entityId);
      return resolvedArea ? areaSet.has(resolvedArea) : false;
    };

    const energySeriesDaily = summaryAllDaily.seriesKwhByArea
      .filter((series) => matchesArea(series.area))
      .map((series) => ({
        ...series,
        points: series.points.filter((p) => inRange(p.bucketStart)),
      }))
      .filter((series) => series.points.length > 0);

    const energySeriesBucketed = energySeriesDaily.map((series) => ({
      area: series.area,
      points: aggregateKwhPoints(series.points, bucket),
    }));

    const totalSeriesBuckets = new Map<string, { bucketStart: Date; label: string; total: number }>();
    for (const series of energySeriesBucketed) {
      for (const point of series.points) {
        const date = new Date(point.bucketStart);
        if (Number.isNaN(date.getTime())) continue;
        const key = point.bucketStart;
        const existing = totalSeriesBuckets.get(key);
        if (!existing) {
          totalSeriesBuckets.set(key, { bucketStart: date, label: point.label, total: point.totalKwhDelta || 0 });
        } else {
          existing.total += point.totalKwhDelta || 0;
        }
      }
    }
    const seriesTotalKwh = Array.from(totalSeriesBuckets.values())
      .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime())
      .map((entry) => ({
        bucketStart: entry.bucketStart.toISOString(),
        label: entry.label,
        totalKwhDelta: entry.total,
      }));

    const seriesTotalCost =
      summaryAllDaily.pricePerKwh == null
        ? []
        : seriesTotalKwh.map((entry) => ({
            bucketStart: entry.bucketStart,
            label: entry.label,
            estimatedCost: entry.totalKwhDelta * summaryAllDaily.pricePerKwh!,
          }));

    const batterySeriesDaily = summaryAllDaily.seriesBatteryByEntity
      .filter((series) => matchesBatteryEntity(series.entityId))
      .map((series) => ({
        ...series,
        points: series.points.filter((p) => inRange(p.bucketStart)),
      }))
      .filter((series) => series.points.length > 0);

    const seriesBatteryByEntity = batterySeriesDaily.map((series) => ({
      entityId: series.entityId,
      name: series.name,
      label: series.label,
      points: aggregateBatteryEntityPoints(series.points, bucket),
    }));

    const seriesBatteryAvgPercent = aggregateBatteryAvgPoints(
      summaryAllDaily.seriesBatteryAvgPercent.filter((p) => inRange(p.bucketStart)),
      bucket
    );

    const batteryLow: BatteryRow[] = [];
    for (const series of batterySeriesDaily) {
      const latest = series.points[series.points.length - 1];
      if (!latest) continue;
      if (latest.avgPercent < 25) {
        batteryLow.push({
          entityId: series.entityId,
          name: series.name,
          label: series.label,
          latestBatteryPercent: latest.avgPercent,
          capturedAt: latest.bucketStart,
        });
      }
    }

    const batteryLatestByEntity = (summaryAllDaily.batteryLatestByEntity ?? [])
      .filter((row) => {
        if (selectedBatteryEntities.length > 0 && !batterySet.has(row.entityId)) return false;
        if (!hasAreaFilter) return true;
        const resolvedArea = (row.area ?? batteryEntityAreaMap.get(row.entityId) ?? '').trim();
        return resolvedArea ? areaSet.has(resolvedArea) : false;
      })
      .map((row) => ({
        ...row,
        area: row.area ?? batteryEntityAreaMap.get(row.entityId) ?? null,
      }));

    const areaTotals = new Map<string, number>();
    for (const series of energySeriesDaily) {
      const total = series.points.reduce((sum, p) => sum + (p.totalKwhDelta || 0), 0);
      areaTotals.set(series.area, total);
    }

    const byArea = summaryAllDaily.byArea
      .filter((row) => matchesArea(row.area))
      .map((row) => {
        const total = areaTotals.get(row.area) ?? 0;
        return {
          ...row,
          totalKwhDelta: total,
          estimatedCost: summaryAllDaily.pricePerKwh == null ? undefined : total * summaryAllDaily.pricePerKwh,
          topEntities: row.topEntities.filter((entity) => matchesEnergyEntity(entity.entityId, row.area)),
        };
      })
      .sort((a, b) => b.totalKwhDelta - a.totalKwhDelta);

    const topEntities = summaryAllDaily.topEntities.filter((row) => matchesEnergyEntity(row.entityId, row.area));

    const rangeFrom = rangeWindow && rangeReady ? rangeWindow.from.toISOString() : summaryAllDaily.range.from;
    const rangeTo = rangeWindow && rangeReady ? rangeWindow.to.toISOString() : summaryAllDaily.range.to;

    return {
      ...summaryAllDaily,
      bucket,
      range: { from: rangeFrom, to: rangeTo },
      seriesTotalKwh,
      seriesTotalCost,
      seriesKwhByArea: energySeriesBucketed,
      seriesBatteryAvgPercent,
      seriesBatteryByEntity,
      topEntities,
      byArea,
      batteryLow,
      batteryLatestByEntity,
    };
  }, [
    summaryAllDaily,
    selectedAreas,
    selectedEnergyEntities,
    selectedBatteryEntities,
    energyEntityAreaMap,
    batteryEntityAreaMap,
    bucket,
    preset,
    from,
    to,
    rangeState.window,
  ]);

  const hubUnknownRanges = useMemo(() => {
    if (!summary || hubStatusPoints.length === 0) return [];
    const fromDate = new Date(summary.range?.from ?? '');
    const toDate = new Date(summary.range?.to ?? '');
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return [];
    return computeOfflineRanges(hubStatusPoints, { from: fromDate, to: toDate });
  }, [hubStatusPoints, summary]);

  const totalKwh = useMemo(() => {
    if (!summary) return 0;
    return summary.seriesKwhByArea
      .filter((series) => (series.area || '').toLowerCase() !== 'unassigned')
      .reduce((sum, series) => sum + series.points.reduce((areaSum, point) => areaSum + (point.totalKwhDelta || 0), 0), 0);
  }, [summary]);
  const totalCost = useMemo(() => {
    if (!summary || summary.pricePerKwh == null) return null;
    return totalKwh * summary.pricePerKwh;
  }, [summary, totalKwh]);

  const gasTotalKwh = useMemo(() => sumMetricPoints(radiatorUsageKwhTotals), [radiatorUsageKwhTotals]);
  const gasTotalCost = useMemo(() => sumMetricPoints(radiatorCostTotals), [radiatorCostTotals]);

  const activeTotalKwh = energyTab === 'gas' ? gasTotalKwh : totalKwh;
  const activeTotalCost = energyTab === 'gas' ? gasTotalCost : totalCost;

  const activeBatteryLowCount = useMemo(() => {
    const rows = summary?.batteryLow ?? [];
    return rows.filter((row) => (energyTab === 'gas' ? isGasLabel(row.label) : !isGasLabel(row.label))).length;
  }, [summary, energyTab]);

  const energySeriesByArea: MultiSeriesTrend[] = useMemo(
    () =>
      (summary?.seriesKwhByArea ?? []).map((series) => ({
        id: series.area,
        label: series.area,
        points: series.points.map((p) => ({
          date: new Date(p.bucketStart),
          label: p.label,
          value: p.totalKwhDelta ?? 0,
        })),
      })),
    [summary]
  );

  const energyBarSeriesByArea: MetricSeries[] = useMemo(() => {
    const raw = summary?.seriesKwhByArea ?? [];
    const ranked = raw
      .map((s) => ({
        area: s.area,
        total: (s.points ?? []).reduce((sum, p) => sum + (p.totalKwhDelta ?? 0), 0),
        points: s.points ?? [],
      }))
      .filter((s) => (s.area || '').toLowerCase() !== 'unassigned' && s.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    return ranked.map((s) => ({
      id: s.area,
      label: s.area,
      points: s.points
        .map((p) => {
          const date = new Date(p.bucketStart);
          return {
            date,
            label: p.label,
            value: p.totalKwhDelta ?? 0,
          };
        })
        .filter((p) => !Number.isNaN(p.date.getTime())),
    }));
  }, [summary]);

  const energyBarSeriesByEntity: MetricSeries[] = useMemo(() => {
    const ranked = (electricEnergyByEntity ?? [])
      .map((s) => ({
        ...s,
        total: typeof s.totalKwhDelta === 'number' && Number.isFinite(s.totalKwhDelta) ? s.totalKwhDelta : 0,
      }))
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    return ranked.map((s) => ({
      id: s.entityId,
      label: s.name || s.entityId,
      points: (s.points ?? [])
        .map((p) => {
          const date = new Date(p.bucketStart);
          return {
            date,
            label: p.label,
            value: p.totalKwhDelta ?? 0,
          };
        })
        .filter((p) => !Number.isNaN(p.date.getTime())),
    }));
  }, [electricEnergyByEntity]);

  const batterySeriesByEntity: MultiSeriesTrend[] = useMemo(() => {
    const series = summary?.seriesBatteryByEntity ?? [];
    const filtered = series.filter((s) => {
      const isGas = isGasLabel(s.label) || gasEntityIds.has(s.entityId);
      return energyTab === 'gas' ? isGas : !isGas;
    });
    return filtered.map((s) => ({
      id: s.entityId,
      label: s.name || s.entityId,
      hint: s.entityId,
      points: s.points.map((p) => ({
        date: new Date(p.bucketStart),
        label: p.label,
        value: p.avgPercent ?? 0,
      })),
    }));
  }, [summary, energyTab, gasEntityIds]);

  const radiatorTemperatureSeriesFiltered = useMemo(() => {
    const hasAreaFilter = selectedAreas.length > 0;
    const areaSet = new Set(selectedAreas);
    const radiatorEntitySet = new Set(selectedRadiatorEntities);
    const hasRadiatorEntityFilter = radiatorEntitySet.size > 0;
    const rangeWindow = rangeState.window;
    const rangeReady = preset !== 'custom' || (from && to);
    const inRange = (iso: string) => {
      if (!rangeWindow || !rangeReady) return true;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return false;
      return date >= rangeWindow.from && date <= rangeWindow.to;
    };

    return radiatorTemperatureSeriesAll
      .filter((series) => {
        if (hasAreaFilter && !areaSet.has(series.area)) return false;
        if (hasRadiatorEntityFilter && !radiatorEntitySet.has(series.entityId)) return false;
        return true;
      })
      .map((series) => ({
        ...series,
        points: series.points.filter((p) => inRange(p.bucketStart)),
      }))
      .filter((series) => series.points.length > 0);
  }, [
    radiatorTemperatureSeriesAll,
    selectedAreas,
    selectedRadiatorEntities,
    preset,
    from,
    to,
    rangeState.window,
  ]);

  const radiatorTemperatureSeriesByEntity = useMemo(
    () =>
      radiatorTemperatureSeriesFiltered.map((series) => ({
        id: series.entityId,
        label: series.name || series.entityId,
        hint: `${series.entityId} • ${series.area}`,
        color: stableColorById(series.entityId),
        points: series.points.map((point) => ({
          date: new Date(point.bucketStart),
          label: point.label,
          currentTemperature: point.currentTemperature,
          targetTemperature: point.targetTemperature,
        })),
      })),
    [radiatorTemperatureSeriesFiltered]
  );

  const radiatorTemperaturePointCount = useMemo(
    () => Math.max(0, ...radiatorTemperatureSeriesByEntity.map((s) => s.points.length)),
    [radiatorTemperatureSeriesByEntity]
  );
  const energyPointCount = useMemo(
    () => Math.max(0, ...energySeriesByArea.map((s) => s.points.length)),
    [energySeriesByArea]
  );
  const batteryPointCount = useMemo(
    () => Math.max(0, ...batterySeriesByEntity.map((s) => s.points.length)),
    [batterySeriesByEntity]
  );
  // Auto-scroll removed: admin charts should keep axes visible and avoid tooltip clipping.

  // Coverage removed from UI; metric no longer used

  const batteryLowCount = activeBatteryLowCount;

  const buildSummaryParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('bucket', 'daily');
    params.set('days', 'all');
    return params.toString();
  }, []);

  const buildSelectorParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('days', 'all');
    return params.toString();
  }, []);

  const buildElectricEnergyByEntityParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('bucket', bucket);
    if (preset === 'custom') {
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else {
      params.set('days', preset);
    }
    for (const area of selectedAreas) params.append('areas', area);
    for (const entityId of selectedEnergyEntities) params.append('entityIds', entityId);
    params.append('excludeLabels', 'Boiler');
    params.append('excludeLabels', 'Radiator');
    return params.toString();
  }, [bucket, preset, from, to, selectedAreas, selectedEnergyEntities]);

  const buildHubStatusParams = useCallback(() => {
    const params = new URLSearchParams();
    if (preset === 'custom') {
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else {
      params.set('days', preset);
    }
    return params.toString();
  }, [preset, from, to]);

  const loadElectricEnergyByEntity = useCallback(async () => {
    if (preset === 'custom' && (!from || !to)) return;
    if (rangeError) return;
    setElectricEnergyLoading(true);
    setElectricEnergyError(null);
    try {
      const params = buildElectricEnergyByEntityParams();
      const res = await platformFetch(`/api/admin/monitoring/energy-by-entity?${params}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => null)) as EnergyByEntityResponse | null;
      if (!res.ok || !data?.ok) {
        const message = data && typeof data.error === 'string' && data.error.length > 0 ? data.error : 'Unable to load device energy trends.';
        throw new Error(message);
      }
      setElectricEnergyByEntity(Array.isArray(data.seriesByEntity) ? data.seriesByEntity : []);
    } catch (err) {
      console.error('Failed to load electric energy by entity', err);
      setElectricEnergyError(friendlyUnknownError(err, 'Unable to load device energy trends.'));
      setElectricEnergyByEntity([]);
    } finally {
      setElectricEnergyLoading(false);
    }
  }, [preset, from, to, rangeError, buildElectricEnergyByEntityParams]);

  const loadSummary = useCallback(async (paramsOverride?: string) => {
    setError(null);
    try {
      const params = paramsOverride ?? buildSummaryParams();
      const [summaryRes, hubRes] = await Promise.all([
        platformFetch(`/api/admin/monitoring/summary?${params}`, {
          cache: 'no-store',
          credentials: 'include',
        }),
        platformFetch(`/api/admin/monitoring/hub-status?${buildHubStatusParams()}`, {
          cache: 'no-store',
          credentials: 'include',
        }),
      ]);

      const summaryData = (await summaryRes.json().catch(() => null)) as (SummaryResponse & { error?: string }) | null;
      if (!summaryRes.ok || !summaryData?.ok) {
        const message =
          summaryData && typeof summaryData.error === 'string' && summaryData.error.length > 0 ? summaryData.error : 'Unable to load analytics right now.';
        throw new Error(message);
      }
      setSummaryAllDaily(summaryData);

      const hubData = (await hubRes.json().catch(() => null)) as HubStatusResponse | null;
      if (hubRes.ok && hubData?.ok) {
        setHubStatusError(null);
        setHubStatusPoints(Array.isArray(hubData.points) ? hubData.points : []);
      } else {
        setHubStatusPoints([]);
        const message = hubData && typeof hubData.error === 'string' && hubData.error.length > 0 ? hubData.error : 'Unable to load hub status.';
        setHubStatusError(message);
      }

      setLastFetchedAt(new Date().toISOString());
    } catch (err) {
      console.error('Failed to load summary', err);
      setError(friendlyUnknownError(err, 'Unable to load analytics right now.'));
      setSummaryAllDaily(null);
      setHubStatusPoints([]);
      setHubStatusError(null);
    }
  }, [buildHubStatusParams, buildSummaryParams]);

  const loadSelectors = useCallback(async () => {
    try {
      setSelectorsError(null);
      const [areasRes, entitiesRes, radiatorRes, boilerRes] = await Promise.all([
        platformFetch('/api/admin/areas', { cache: 'no-store', credentials: 'include' }),
        platformFetch(`/api/admin/monitoring/entities?${buildSelectorParams()}`, { cache: 'no-store', credentials: 'include' }),
        platformFetch(`/api/admin/monitoring/boiler-entities?${buildSelectorParams()}&label=Radiator`, {
          cache: 'no-store',
          credentials: 'include',
        }),
        platformFetch(`/api/admin/monitoring/boiler-entities?${buildSelectorParams()}&label=Boiler`, {
          cache: 'no-store',
          credentials: 'include',
        }),
      ]);
      const areasData = await areasRes.json().catch(() => ({}));
      const entitiesData = await entitiesRes.json().catch(() => ({}));
      const radiatorData = await radiatorRes.json().catch(() => ({}));
      const boilerData = await boilerRes.json().catch(() => ({}));
      if (!areasRes.ok) throw new Error(areasData.error || 'Unable to load areas.');
      if (!entitiesRes.ok) throw new Error(entitiesData.error || 'Unable to load entities.');
      if (!radiatorRes.ok) throw new Error(radiatorData.error || 'Unable to load radiator devices.');
      if (!boilerRes.ok) throw new Error(boilerData.error || 'Unable to load boiler devices.');
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
      const radiatorList = Array.isArray(radiatorData.boilerEntities) ? radiatorData.boilerEntities : [];
      setRadiatorEntities(radiatorList.filter((e: EntityOption) => (e.area || '').toLowerCase() !== 'unassigned'));
      const boilerList = Array.isArray(boilerData.boilerEntities) ? boilerData.boilerEntities : [];
      setBoilerEntities(boilerList.filter((e: EntityOption) => (e.area || '').toLowerCase() !== 'unassigned'));

      const energyIds = new Set(energyList.map((e: EntityOption) => e.entityId));
      const batteryIds = new Set(batteryList.map((e: EntityOption) => e.entityId));
      const radiatorIds = new Set(radiatorList.map((e: EntityOption) => e.entityId));
      const boilerIds = new Set(boilerList.map((e: EntityOption) => e.entityId));
      setSelectedEnergyEntities((prev) => prev.filter((id) => energyIds.has(id)));
      setSelectedBatteryEntities((prev) => prev.filter((id) => batteryIds.has(id)));
      setSelectedRadiatorEntities((prev) => prev.filter((id) => radiatorIds.has(id)));
      setSelectedBoilerEntities((prev) => prev.filter((id) => boilerIds.has(id)));
      setSelectorsLoaded(true);
    } catch (err) {
      console.error('Failed to load selectors', err);
      setSelectorsError(friendlyUnknownError(err, 'Unable to load filters.'));
      setSelectorsLoaded(false);
    }
  }, [buildSelectorParams]);

  const loadHeatingHistory = useCallback(async () => {
    setBoilerLoading(true);
    setBoilerError(null);
    try {
	        const buildHistoryParams = (
	          label: 'Boiler' | 'Radiator',
	          metric: 'minutesOn' | 'kwh' | 'costGbp',
	          groupBy: 'total' | 'entity',
	          entityIds?: string[],
	          boilerEntityIds?: string[]
	        ) => {
	          const params = new URLSearchParams();
	          params.set('label', label);
	          params.set('metric', metric);
	          params.set('groupBy', groupBy);
	          params.set('bucket', bucket);
	          if (metric !== 'costGbp') params.set('grain', bucket === 'daily' ? 'snapshot' : 'bucket');

	        if (preset === 'all') {
	          params.set('days', 'all');
	        } else if (preset === 'custom') {
	          if (from && to) {
	            params.set('from', from);
	            params.set('to', to);
	          } else {
	            params.set('days', '7');
	          }
	        } else {
	          params.set('days', preset);
	        }

	        selectedAreas.forEach((area) => params.append('areas', area));
	        (entityIds ?? []).forEach((id) => params.append('entityIds', id));
	        (boilerEntityIds ?? []).forEach((id) => params.append('boilerEntityIds', id));
	        return params.toString();
	      };

      const buildBoilerHistoryParams = (label: 'Boiler' | 'Radiator', entityIds: string[]) => {
        const params = new URLSearchParams();
        params.set('label', label);
        params.set('bucket', bucket);
        if (preset === 'all') {
          params.set('days', 'all');
        } else if (preset === 'custom') {
          if (from && to) {
            params.set('from', from);
            params.set('to', to);
          } else {
            params.set('days', '7');
          }
        } else {
          params.set('days', preset);
        }
        selectedAreas.forEach((area) => params.append('areas', area));
        entityIds.forEach((id) => params.append('entityIds', id));
        return params.toString();
      };

      const selectedRadiators =
        selectedRadiatorEntities.length > 0
          ? selectedRadiatorEntities
          : radiatorEntities.map((e) => e.entityId);
      const selectedBoilers =
        selectedBoilerEntities.length > 0
          ? selectedBoilerEntities
          : boilerEntities.map((e) => e.entityId);

      const [
        radiatorRes,
        boilerMinutesRes,
        radiatorMinutesRes,
        radiatorMinutesByEntityRes,
        boilerKwhRes,
        radiatorKwhRes,
        boilerCostRes,
        radiatorCostRes,
        radiatorKwhByEntityRes,
        radiatorCostByEntityRes,
      ] =
        await Promise.all([
        platformFetch(`/api/admin/monitoring/boiler-history?${buildBoilerHistoryParams('Radiator', selectedRadiators)}`, {
          cache: 'no-store',
          credentials: 'include',
        }),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Boiler', 'minutesOn', 'total', selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Radiator', 'minutesOn', 'total', selectedRadiators)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Radiator', 'minutesOn', 'entity', selectedRadiators, selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Boiler', 'kwh', 'total', selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Radiator', 'kwh', 'total', selectedRadiators, selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Boiler', 'costGbp', 'total', selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Radiator', 'costGbp', 'total', selectedRadiators, selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Radiator', 'kwh', 'entity', selectedRadiators, selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
        platformFetch(
          `/api/admin/monitoring/heating-usage-history?${buildHistoryParams('Radiator', 'costGbp', 'entity', selectedRadiators, selectedBoilers)}`,
          { cache: 'no-store', credentials: 'include' }
        ),
      ]);

      const radiatorData = (await radiatorRes.json().catch(() => null)) as BoilerHistoryResponse | null;
      if (!radiatorRes.ok || !radiatorData?.ok) {
        const message =
          radiatorData && typeof radiatorData.error === 'string' && radiatorData.error.length > 0
            ? radiatorData.error
            : 'Unable to load radiator trend.';
        throw new Error(message);
      }

      const temperatureSeries: BoilerTemperatureSeries[] = Array.isArray(radiatorData.seriesTemperatureByEntity)
        ? radiatorData.seriesTemperatureByEntity
        : Array.isArray(radiatorData.seriesByEntity)
        ? radiatorData.seriesByEntity.map((series) => ({
            entityId: series.entityId,
            name: series.name,
            area: series.area,
            points: series.points.map((point) => ({
              bucketStart: point.bucketStart,
              label: point.label,
              currentTemperature: point.value,
              targetTemperature: null,
            })),
          }))
        : [];

      const parseHistoryPayload = async (res: Response, fallbackMessage: string) => {
        const data = (await res.json().catch(() => null)) as HeatingUsageHistoryResponse | null;
        if (!res.ok || !data?.ok) {
          const message = data && typeof data.error === 'string' && data.error.length > 0 ? data.error : fallbackMessage;
          throw new Error(message);
        }
        return data;
      };

      const parseHistoryTotalPoints = (data: HeatingUsageHistoryResponse) => {
        const series = Array.isArray(data.seriesByEntity) ? data.seriesByEntity : [];
        const total = series[0];
        const points: MetricPoint[] = (total?.points ?? [])
          .map((p) => {
            const date = new Date(p.ts);
            return {
              date,
              label: typeof p.label === 'string' && p.label.length > 0 ? p.label : Number.isNaN(date.getTime()) ? String(p.ts ?? '') : formatSnapshotLabel(date),
              value: typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : 0,
            };
          })
          .filter((p) => !Number.isNaN(p.date.getTime()))
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        return points;
      };

      const parseHistoryEntityTotals = (data: HeatingUsageHistoryResponse) => {
        const series = Array.isArray(data.seriesByEntity) ? data.seriesByEntity : [];
        return series
          .filter((s) => (s.entityId ?? '').trim().toLowerCase() !== 'total')
          .map((s) => ({
            entityId: s.entityId,
            name: (s.name || s.entityId).trim() || s.entityId,
            area: s.area ?? null,
            label: s.label ?? null,
            total: (s.points ?? []).reduce((sum, p) => sum + (typeof p?.value === 'number' && Number.isFinite(p.value) ? p.value : 0), 0),
          }))
          .filter((row) => row.total > 0)
          .sort((a, b) => b.total - a.total);
      };

      const parseHistoryEntitySeries = (data: HeatingUsageHistoryResponse) => {
        const series = Array.isArray(data.seriesByEntity) ? data.seriesByEntity : [];
        return series
          .filter((s) => (s.entityId ?? '').trim().toLowerCase() !== 'total')
          .map((s) => ({
            id: s.entityId,
            label: (s.name || s.entityId).trim() || s.entityId,
            points: (s.points ?? [])
              .map((p) => {
                const date = new Date(p.ts);
                return {
                  date,
                  label: typeof p.label === 'string' && p.label.length > 0 ? p.label : Number.isNaN(date.getTime()) ? String(p.ts ?? '') : formatSnapshotLabel(date),
                  value: typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : 0,
                };
              })
              .filter((p) => !Number.isNaN(p.date.getTime()))
              .sort((a, b) => a.date.getTime() - b.date.getTime()),
          }))
          .filter((s) => s.points.length > 0);
      };

      setRadiatorTemperatureSeriesAll(temperatureSeries);
      const [
        boilerMinutesData,
        radiatorMinutesData,
        radiatorMinutesByEntityData,
        boilerKwhData,
        radiatorKwhData,
        boilerCostData,
        radiatorCostData,
        radiatorKwhByEntityData,
        radiatorCostByEntityData,
      ] = await Promise.all([
        parseHistoryPayload(boilerMinutesRes, 'Unable to load boiler usage.'),
        parseHistoryPayload(radiatorMinutesRes, 'Unable to load radiator usage.'),
        parseHistoryPayload(radiatorMinutesByEntityRes, 'Unable to load radiator usage by entity.'),
        parseHistoryPayload(boilerKwhRes, 'Unable to load boiler kWh.'),
        parseHistoryPayload(radiatorKwhRes, 'Unable to load radiator kWh.'),
        parseHistoryPayload(boilerCostRes, 'Unable to load boiler cost.'),
        parseHistoryPayload(radiatorCostRes, 'Unable to load radiator cost.'),
        parseHistoryPayload(radiatorKwhByEntityRes, 'Unable to load radiator kWh by entity.'),
        parseHistoryPayload(radiatorCostByEntityRes, 'Unable to load radiator cost by entity.'),
      ]);

      setBoilerUsageMinutesTotals(parseHistoryTotalPoints(boilerMinutesData));
      setRadiatorUsageMinutesTotals(parseHistoryTotalPoints(radiatorMinutesData));
      setRadiatorUsageMinutesByEntity(parseHistoryEntitySeries(radiatorMinutesByEntityData));
      setBoilerUsageKwhTotals(parseHistoryTotalPoints(boilerKwhData));
      setRadiatorUsageKwhTotals(parseHistoryTotalPoints(radiatorKwhData));
      setBoilerCostTotals(parseHistoryTotalPoints(boilerCostData));
      setRadiatorCostTotals(parseHistoryTotalPoints(radiatorCostData));
      setRadiatorUsageKwhByEntity(parseHistoryEntitySeries(radiatorKwhByEntityData));
      setRadiatorCostByEntity(parseHistoryEntitySeries(radiatorCostByEntityData));

      const radiatorKwhByEntity = parseHistoryEntityTotals(radiatorKwhByEntityData);
      const radiatorCostByEntity = parseHistoryEntityTotals(radiatorCostByEntityData);

      const costByEntity = new Map<string, number>();
      for (const row of radiatorCostByEntity) {
        costByEntity.set(row.entityId, row.total);
      }
      const merged: GasTopEntity[] = radiatorKwhByEntity.map((row) => ({
        entityId: row.entityId,
        name: row.name,
        area: row.area,
        label: row.label,
        totalKwh: row.total,
        totalCost: costByEntity.get(row.entityId) ?? null,
      }));
      merged.sort((a, b) => b.totalKwh - a.totalKwh);
      setGasTopEntities(merged.slice(0, 20));
    } catch (err) {
      console.error('Failed to load heating trends', err);
      setBoilerError(friendlyUnknownError(err, 'Unable to load heating trends.'));
      setRadiatorTemperatureSeriesAll([]);
      setBoilerUsageMinutesTotals([]);
      setRadiatorUsageMinutesTotals([]);
      setRadiatorUsageMinutesByEntity([]);
      setBoilerUsageKwhTotals([]);
      setRadiatorUsageKwhTotals([]);
      setRadiatorUsageKwhByEntity([]);
      setBoilerCostTotals([]);
      setRadiatorCostTotals([]);
      setRadiatorCostByEntity([]);
      setGasTopEntities([]);
    } finally {
      setBoilerLoading(false);
    }
  }, [
    boilerEntities,
    bucket,
    from,
    preset,
    radiatorEntities,
    selectedAreas,
    selectedBoilerEntities,
    selectedRadiatorEntities,
    to,
  ]);

  const hardReloadAll = useCallback(async () => {
    setSummaryAllDaily(null);
    setError(null);
    setLastFetchedAt(null);
    setHubStatusPoints([]);
    setHubStatusError(null);

    setSelectorsLoaded(false);
    setSelectorsError(null);
    setAreas([]);
    setEnergyEntities([]);
    setBatteryEntities([]);
    setRadiatorEntities([]);
    setBoilerEntities([]);

    setRadiatorTemperatureSeriesAll([]);
    setBoilerUsageMinutesTotals([]);
    setRadiatorUsageMinutesTotals([]);
    setRadiatorUsageMinutesByEntity([]);
    setBoilerUsageKwhTotals([]);
    setRadiatorUsageKwhTotals([]);
    setRadiatorUsageKwhByEntity([]);
    setBoilerCostTotals([]);
    setRadiatorCostTotals([]);
    setRadiatorCostByEntity([]);
    setGasTopEntities([]);
    setBoilerError(null);

    setElectricEnergyByEntity([]);
    setElectricEnergyError(null);

    setLoading(true);
    setBoilerLoading(true);
    setElectricEnergyLoading(true);

    try {
      await Promise.all([loadSummary(), loadSelectors()]);
      await Promise.all([loadHeatingHistory(), loadElectricEnergyByEntity()]);
    } finally {
      setLoading(false);
      setBoilerLoading(false);
      setElectricEnergyLoading(false);
    }
  }, [loadSelectors, loadHeatingHistory, loadElectricEnergyByEntity, loadSummary]);

  const hardReloadAllRef = useRef(hardReloadAll);
  useEffect(() => {
    hardReloadAllRef.current = hardReloadAll;
  }, [hardReloadAll]);

  useEffect(() => {
    void hardReloadAllRef.current();
  }, []);

  const lastSnapshotDisplay = summaryAllDaily ? formatDateTime(summaryAllDaily.lastSnapshotAt) : 'Not available';
  const lastFetchedDisplay = lastFetchedAt ? formatDateTime(lastFetchedAt) : 'Never';
  const isRefreshing = loading || boilerLoading || electricEnergyLoading;
  const handleRefresh = () => {
    void hardReloadAll();
  };

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
                    href="/admin/dashboard"
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

        <div className="flex justify-center">
          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setEnergyTab('gas')}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                energyTab === 'gas' ? 'bg-orange-600 text-white' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              Gas
            </button>
            <button
              type="button"
              onClick={() => setEnergyTab('electric')}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                energyTab === 'electric' ? 'bg-sky-600 text-white' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              Electric
            </button>
          </div>
        </div>

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
	                onClick={handleRefresh}
	                disabled={isRefreshing}
	                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
	              >
	                {isRefreshing && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-white" />}
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
          {rangeError && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {rangeError}
            </div>
          )}
          {selectorsError && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {selectorsError}
            </div>
          )}
          {hubStatusError && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Hub status unavailable; unknown/offline shading may be missing. {hubStatusError}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
          <MultiSelect
            label="Areas"
            options={areas.map((a) => ({ id: a, label: a, hint: a }))}
            selected={selectedAreas}
            onChange={setSelectedAreas}
            placeholder={selectorsLoaded ? 'All areas' : 'Loading areas…'}
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Total energy</p>
            <p className="text-2xl font-semibold text-slate-900">{numberFmt.format(activeTotalKwh)} kWh</p>
            <p className="text-xs text-slate-500">{summary ? `${formatDateTime(summary.range.from)} → ${formatDateTime(summary.range.to)}` : ''}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Estimated cost</p>
            <p className="text-2xl font-semibold text-slate-900">
              {activeTotalCost != null ? costFmt.format(activeTotalCost) : energyTab === 'electric' ? 'Price not set' : 'Not available'}
            </p>
            <p className="text-xs text-slate-500">
              {energyTab === 'electric'
                ? summary?.pricePerKwh != null
                  ? `Price £${summary.pricePerKwh}/kWh`
                  : 'Set ELECTRICITY_PRICE_PER_KWH'
                : 'Heating cost derived from heating usage'}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Low battery</p>
            <p className="text-2xl font-semibold text-slate-900">{batteryLowCount}</p>
            <p className="text-xs text-slate-500">Below 25%</p>
          </div>
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
                  {energyTab === 'gas'
                    ? gasTopEntities.map((row) => (
                        <tr key={row.entityId} className="odd:bg-white even:bg-slate-50/60">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{row.name || row.entityId}</div>
                            <div className="font-mono text-[11px] text-slate-500">{row.entityId}</div>
                          </td>
                          <td className="px-3 py-2">{row.area ?? 'Unassigned'}</td>
                          <td className="px-3 py-2 text-right">{row.totalKwh.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">{row.totalCost != null ? costFmt.format(row.totalCost) : '—'}</td>
                        </tr>
                      ))
                    : (summary?.topEntities ?? [])
                        .filter((row) => !isGasLabel(row.label))
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

                  {energyTab === 'gas' && gasTopEntities.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                        No heating readings in this window.
                      </td>
                    </tr>
                  )}
                  {energyTab === 'electric' && (summary?.topEntities?.length ?? 0) === 0 && (
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

          {energyTab === 'electric' ? (
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
          ) : (
            <div className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Heating notes</h3>
                <span className="text-xs text-slate-500">Gas dashboard</span>
              </div>
              <p className="text-sm text-slate-600">
                Heating insights are computed from boiler/radiator usage readings (not the electricity snapshot tables).
              </p>
            </div>
          )}
        </section>

        {energyTab === 'electric' ? (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Energy trends</h2>
              <span className="text-xs text-slate-500">
                Bucket: {bucket}, points: {energyPointCount}
              </span>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
              <MultiSelect
                label="Energy entities"
                options={energyEntities
                  .filter((e) => !isGasLabel(e.label))
                  .map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
                selected={selectedEnergyEntities}
                onChange={setSelectedEnergyEntities}
                placeholder="All energy entities"
              />
            </div>
            {electricEnergyError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {electricEnergyError}
              </div>
            ) : null}
	            <MetricGroupedBarChart
	              id="electric-energy-by-area"
	              title="Energy trends by area"
	              unitLabel="kWh"
	              series={energyBarSeriesByArea}
	              bucket={bucket}
	              unknownRanges={hubUnknownRanges}
	              emptyLabel="No energy readings in this window."
	              formatValue={(v) => v.toFixed(2)}
	              xTickMode={bucket === 'daily' ? 'day' : 'auto'}
	            />
            {electricEnergyLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading device energy…
              </div>
            ) : (
	              <MetricGroupedBarChart
	                id="electric-energy-by-device"
	                title="Energy trends per device"
	                unitLabel="kWh"
	                series={energyBarSeriesByEntity}
	                bucket={bucket}
	                unknownRanges={hubUnknownRanges}
	                emptyLabel="No device energy readings in this window."
	                formatValue={(v) => v.toFixed(2)}
	                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
	              />
            )}
          </section>
        ) : null}

        {energyTab === 'gas' ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Heating trends</h2>
            <span className="text-xs text-slate-500">
              Radiator temp points: {radiatorTemperaturePointCount}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
            <div className="flex flex-wrap gap-3">
              <MultiSelect
                label="Radiator devices"
                options={radiatorEntities.map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
                selected={selectedRadiatorEntities}
                onChange={setSelectedRadiatorEntities}
                placeholder="All radiators"
              />
              <MultiSelect
                label="Boiler devices"
                options={boilerEntities.map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
                selected={selectedBoilerEntities}
                onChange={setSelectedBoilerEntities}
                placeholder="All boilers"
              />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading heating charts…
              </div>
            ) : radiatorTemperatureSeriesByEntity.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No radiator readings in this window.
              </div>
            ) : (
	              <BoilerTemperatureBandChart
	                id="radiator-temperature-current"
	                title="Radiator current temperature"
	                series={radiatorTemperatureSeriesByEntity}
	                bucket={bucket}
	                unknownRanges={hubUnknownRanges}
	                emptyLabel="No radiator readings in this window."
	                showTarget={false}
	              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading boiler usage…
              </div>
            ) : boilerUsageMinutesTotals.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No boiler usage totals in this window.
              </div>
            ) : (
		              <MetricTotalsBarChart
		                id="boiler-usage-minutes"
		                title="Boiler usage (minutes ON)"
		                unitLabel="min"
		                points={boilerUsageMinutesTotals}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                color="#f97316"
		                formatValue={(v) => v.toFixed(0)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading radiator usage…
              </div>
            ) : radiatorUsageMinutesTotals.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No radiator usage totals in this window.
              </div>
            ) : (
		              <MetricTotalsBarChart
		                id="radiator-usage-minutes"
		                title="Radiator usage (minutes ON)"
		                unitLabel="min"
		                points={radiatorUsageMinutesTotals}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                color="#0ea5e9"
		                formatValue={(v) => v.toFixed(0)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading radiator usage by radiator…
              </div>
            ) : radiatorUsageMinutesByEntity.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No radiator usage by radiator in this window.
              </div>
            ) : (
		              <MetricGroupedBarChart
		                id="radiator-usage-minutes-by-entity"
		                title="Radiator usage (minutes ON) by radiator"
		                unitLabel="min"
		                series={radiatorUsageMinutesByEntity}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                formatValue={(v) => v.toFixed(0)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading boiler kWh…
              </div>
            ) : boilerUsageKwhTotals.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No boiler kWh totals in this window.
              </div>
            ) : (
		              <MetricTotalsBarChart
		                id="boiler-usage-kwh"
		                title="Boiler energy (kWh)"
		                unitLabel="kWh"
		                points={boilerUsageKwhTotals}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                color="#ff9500"
		                formatValue={(v) => v.toFixed(2)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading radiator kWh…
              </div>
            ) : radiatorUsageKwhTotals.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No radiator kWh totals in this window.
              </div>
            ) : (
		              <MetricTotalsBarChart
		                id="radiator-usage-kwh"
		                title="Radiator energy (kWh, allocated)"
		                unitLabel="kWh"
		                points={radiatorUsageKwhTotals}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                color="#34c759"
		                formatValue={(v) => v.toFixed(2)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading radiator energy by radiator…
              </div>
            ) : radiatorUsageKwhByEntity.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No radiator energy by radiator in this window.
              </div>
            ) : (
		              <MetricGroupedBarChart
		                id="radiator-usage-kwh-by-entity"
		                title="Radiator energy (kWh) by radiator"
		                unitLabel="kWh"
		                series={radiatorUsageKwhByEntity}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                formatValue={(v) => v.toFixed(2)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading boiler cost…
              </div>
            ) : boilerCostTotals.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No boiler cost totals in this window.
              </div>
            ) : (
		              <MetricTotalsBarChart
		                id="boiler-cost-daily"
		                title="Boiler running cost"
		                unitLabel="GBP"
		                points={boilerCostTotals}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                color="#ff3b30"
		                formatValue={(v) => costFmt.format(v)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading radiator costs…
              </div>
            ) : radiatorCostTotals.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No radiator cost data in this window.
              </div>
            ) : (
		              <MetricTotalsBarChart
		                id="radiator-cost-daily"
		                title="Radiator cost (daily total)"
		                unitLabel="GBP"
		                points={radiatorCostTotals}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                color="#af52de"
		                formatValue={(v) => costFmt.format(v)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}

            {boilerError ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                {boilerError}
              </div>
            ) : boilerLoading ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                Loading radiator cost by radiator…
              </div>
            ) : radiatorCostByEntity.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/80 text-sm text-slate-400">
                No radiator cost by radiator in this window.
              </div>
            ) : (
		              <MetricGroupedBarChart
		                id="radiator-cost-by-entity"
		                title="Radiator cost (GBP) by radiator"
		                unitLabel="GBP"
		                series={radiatorCostByEntity}
		                bucket={bucket}
		                unknownRanges={hubUnknownRanges}
		                formatValue={(v) => costFmt.format(v)}
		                xTickMode={bucket === 'daily' ? 'day' : 'auto'}
		              />
            )}
          </div>
        </section>
        ) : null}

        <section className="space-y-3 rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Device Battery Levels</h3>
            <span className="text-xs text-slate-500">Latest per device</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <table className="w-full text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Entity</th>
                  <th className="px-3 py-2 text-left">Battery</th>
                  <th className="px-3 py-2 text-left">Captured at (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.batteryLatestByEntity ?? [])
                  .filter((row) => {
                    const isGas = isGasLabel(row.label) || gasEntityIds.has(row.entityId);
                    return energyTab === 'gas' ? isGas : !isGas;
                  })
                  .slice()
                  .sort((a, b) => (a.latestBatteryPercent ?? 0) - (b.latestBatteryPercent ?? 0))
                  .map((row) => {
                    const pct = Math.max(0, Math.min(100, row.latestBatteryPercent ?? 0));
                    const barClass = pct < 25 ? 'bg-red-500' : pct < 50 ? 'bg-amber-500' : 'bg-emerald-500';
                    return (
                      <tr key={row.entityId} className="odd:bg-white even:bg-slate-50/60">
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs">{row.entityId}</div>
                          <div className="text-xs text-slate-500">{row.name || row.entityId}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-28 rounded-full bg-slate-100">
                              <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="w-10 text-right font-semibold tabular-nums">{pct.toFixed(0)}%</div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {new Date(row.capturedAt).toLocaleString('en-GB', { timeZone: 'UTC' })}
                        </td>
                      </tr>
                    );
                  })}
                {((summary?.batteryLatestByEntity ?? [])
                  .filter((row) => {
                    const isGas = isGasLabel(row.label) || gasEntityIds.has(row.entityId);
                    return energyTab === 'gas' ? isGas : !isGas;
                  })
                  .length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                      No battery readings found for this selection.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Color thresholds: ≥50% green, &lt;50% amber, &lt;25% red.</p>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Battery trend</h2>
            <span className="text-xs text-slate-500">
              Bucket: {bucket}, points: {batteryPointCount}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
            <MultiSelect
              label="Battery entities"
              options={batteryEntities
                .filter((e) => {
                  const isGas = isGasLabel(e.label) || gasEntityIds.has(e.entityId);
                  return energyTab === 'gas' ? isGas : !isGas;
                })
                .map((e) => ({ id: e.entityId, label: e.name || e.entityId, hint: e.entityId }))}
              selected={selectedBatteryEntities}
              onChange={setSelectedBatteryEntities}
              placeholder="All battery entities"
            />
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-sm">
	            <MultiLineChart
	              id="battery-trend"
	              title="Battery by entity"
	              series={batterySeriesByEntity}
	              valueUnit="%"
	              unknownRanges={hubUnknownRanges}
	              emptyLabel="No battery readings in this window."
	              formatValue={(v) => v.toFixed(0)}
	              xTickBucket={bucket}
	              xTickLabelFormat={(date) => {
                if (bucket === 'monthly') return date.toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short' });
                if (bucket === 'weekly') {
                  const end = new Date(date.getTime() + 6 * 86400000);
                  return end.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
                }
                return date.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric' });
              }}
            />
          </div>
          <p className="text-xs text-slate-500">Average of latest battery % per entity per bucket.</p>
        </section>
      </div>
    </div>
  );
}
