'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { UIDevice } from '@/types/device';
import {
  getPrimaryLabel,
  getAdditionalLabels,
  normalizeLabel,
} from '@/lib/deviceLabels';

const CAMERA_REFRESH_INTERVAL_MS = 15000;

type DeviceControlsProps = {
  device: UIDevice;
  isDetail?: boolean;
  onActionComplete?: () => void;
  actionSlot?: ReactNode;
};

type ControlPayload = {
  entityId: string;
  command: string;
  value?: number;
};

export function DeviceControls({
  device,
  isDetail = false,
  onActionComplete,
  actionSlot,
}: DeviceControlsProps) {
  const label = getPrimaryLabel(device);
  const areaDisplay = (device.area ?? device.areaName ?? '').trim();
  const attrs = device.attributes || {};
  const brightnessValue = getBrightnessPercent(attrs);
  const volumeValue = getVolumePercent(attrs);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [brightnessPct, setBrightnessPct] = useState(brightnessValue);
  const [volumePct, setVolumePct] = useState(volumeValue);
  const [cameraRefreshToken, setCameraRefreshToken] = useState(() =>
    Date.now()
  );

  useEffect(() => {
    setBrightnessPct(brightnessValue);
  }, [brightnessValue]);

  useEffect(() => {
    setVolumePct(volumeValue);
  }, [volumeValue]);

  useEffect(() => {
    if (label === 'Doorbell' || label === 'Home Security') {
      const id = setInterval(
        () => setCameraRefreshToken(Date.now()),
        CAMERA_REFRESH_INTERVAL_MS
      );
      return () => clearInterval(id);
    }
    return undefined;
  }, [label]);

  const sendControl = useCallback(
    async (payload: ControlPayload) => {
      setPendingCommand(payload.command);
      try {
        const res = await fetch('/api/device-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({ ok: false }));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `Failed with ${res.status}`);
        }
        onActionComplete?.();
      } catch (err) {
        console.error('Device control failed', err);
      } finally {
        setPendingCommand(null);
      }
    },
    [onActionComplete]
  );

  const controls = renderControls({
    device,
    label,
    isDetail,
    pendingCommand,
    brightnessPct,
    setBrightnessPct,
    volumePct,
    setVolumePct,
    sendControl,
  });

  const additionalLabels = getAdditionalLabels(device, label);

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-800">{device.name}</p>
          {label && (
            <span className="inline-flex text-[10px] uppercase tracking-wide text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">
              {label}
            </span>
          )}
          {additionalLabels.length > 0 && (
            <p className="text-[10px] text-slate-500">
              {additionalLabels.join(', ')}
            </p>
          )}
        </div>
        {actionSlot}
      </div>
      <div className="mt-2 text-[11px] text-slate-600">
        Area:{' '}
        <span className="text-slate-800 font-medium">
          {areaDisplay || '—'}
        </span>
      </div>
      <div className="text-[11px] text-slate-600">
        State:{' '}
        <span className="text-slate-800 font-semibold">{device.state}</span>
      </div>

      {renderInfoBlock(label, attrs, device.state, cameraRefreshToken, device.entityId)}

      {controls}
    </div>
  );
}

type RenderControlsArgs = {
  device: UIDevice;
  label: string;
  isDetail: boolean;
  pendingCommand: string | null;
  brightnessPct: number | null;
  setBrightnessPct: (value: number) => void;
  volumePct: number | null;
  setVolumePct: (value: number) => void;
  sendControl: (payload: ControlPayload) => Promise<void>;
};

function renderControls(args: RenderControlsArgs) {
  const {
    device,
    label,
    isDetail,
    pendingCommand,
    brightnessPct,
    setBrightnessPct,
    volumePct,
    setVolumePct,
    sendControl,
  } = args;

  if (isDetail) return null;

  switch (label) {
    case 'Light':
      return (
        <div className="mt-3 space-y-2">
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'light/toggle' })
            }
            disabled={pendingCommand !== null}
          >
            Toggle
          </button>
          {device.domain === 'light' && brightnessPct !== null && (
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span>Brightness</span>
              <input
                type="range"
                min={0}
                max={100}
                value={brightnessPct}
                onChange={(e) => setBrightnessPct(Number(e.target.value))}
                onMouseUp={(e) =>
                  sendControl({
                    entityId: device.entityId,
                    command: 'light/set_brightness',
                    value: Number((e.target as HTMLInputElement).value),
                  })
                }
                onTouchEnd={(e) =>
                  sendControl({
                    entityId: device.entityId,
                    command: 'light/set_brightness',
                    value: Number((e.target as HTMLInputElement).value),
                  })
                }
                className="flex-1"
              />
              <span>{brightnessPct}%</span>
            </div>
          )}
        </div>
      );
    case 'Blind':
      return (
        <div className="mt-3 flex gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'blind/open' })
            }
            disabled={pendingCommand !== null}
          >
            Open
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'blind/close' })
            }
            disabled={pendingCommand !== null}
          >
            Close
          </button>
        </div>
      );
    case 'Spotify':
      return (
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'media/previous' })
            }
            disabled={pendingCommand !== null}
          >
            Previous
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'media/play_pause' })
            }
            disabled={pendingCommand !== null}
          >
            {device.state === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'media/next' })
            }
            disabled={pendingCommand !== null}
          >
            Next
          </button>
        </div>
      );
    case 'Boiler':
      return (
        <div className="mt-3 flex gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'boiler/temp_down' })
            }
            disabled={pendingCommand !== null}
          >
            -1°C
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={() =>
              sendControl({ entityId: device.entityId, command: 'boiler/temp_up' })
            }
            disabled={pendingCommand !== null}
          >
            +1°C
          </button>
        </div>
      );
    case 'TV':
    case 'Speaker':
      return (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <button
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
              onClick={() =>
                sendControl({
                  entityId: device.entityId,
                  command: `${label === 'TV' ? 'tv' : 'speaker'}/toggle_power`,
                })
              }
              disabled={pendingCommand !== null}
            >
              {device.state === 'off' ? 'Power on' : 'Power off'}
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
              onClick={() =>
                sendControl({ entityId: device.entityId, command: 'media/volume_down' })
              }
              disabled={pendingCommand !== null}
            >
              Vol -
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
              onClick={() =>
                sendControl({ entityId: device.entityId, command: 'media/volume_up' })
              }
              disabled={pendingCommand !== null}
            >
              Vol +
            </button>
          </div>
          {volumePct !== null && (
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span>Volume</span>
              <input
                type="range"
                min={0}
                max={100}
                value={volumePct}
                onChange={(e) => setVolumePct(Number(e.target.value))}
                onMouseUp={(e) =>
                  sendControl({
                    entityId: device.entityId,
                    command: 'media/volume_set',
                    value: Number((e.target as HTMLInputElement).value),
                  })
                }
                onTouchEnd={(e) =>
                  sendControl({
                    entityId: device.entityId,
                    command: 'media/volume_set',
                    value: Number((e.target as HTMLInputElement).value),
                  })
                }
                className="flex-1"
              />
              <span>{volumePct}%</span>
            </div>
          )}
        </div>
      );
    case 'Doorbell':
    case 'Home Security':
    case 'Motion Sensor':
      return null;
    default:
      return null;
  }
}

function renderInfoBlock(
  label: string,
  attrs: Record<string, unknown>,
  _state: string,
  cameraRefreshToken: number,
  entityId: string
) {
  switch (label) {
    case 'Spotify':
    case 'TV':
    case 'Speaker':
      const mediaTitle = readStringAttr(attrs, 'media_title');
      const mediaArtist = readStringAttr(attrs, 'media_artist');
      const mediaAlbum = readStringAttr(attrs, 'media_album_name');
      return (
        <div className="mt-3 text-[11px] text-slate-600 space-y-1">
          {mediaTitle && (
            <div>
              <span className="font-semibold">Track:</span> {mediaTitle}
            </div>
          )}
          {mediaArtist && (
            <div>
              <span className="font-semibold">Artist:</span> {mediaArtist}
            </div>
          )}
          {mediaAlbum && (
            <div>
              <span className="font-semibold">Album:</span> {mediaAlbum}
            </div>
          )}
        </div>
      );
    case 'Boiler':
      const target = attrs.temperature;
      const current = attrs.current_temperature;
      return (
        <div className="mt-3 text-[11px] text-slate-600">
          <div>
            <span className="font-semibold">Target:</span>{' '}
            {formatTemperature(target)}
          </div>
          {current !== undefined && (
            <div>
              <span className="font-semibold">Current:</span>{' '}
              {formatTemperature(current)}
            </div>
          )}
        </div>
      );
    case 'Doorbell':
    case 'Home Security':
      return (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/camera-proxy?entityId=${encodeURIComponent(
              entityId
            )}&ts=${cameraRefreshToken}`}
            alt={label}
            className="w-full h-40 object-cover rounded-lg border"
            loading="lazy"
          />
        </div>
      );
    default:
      return null;
  }
}

function getBrightnessPercent(attrs: Record<string, unknown>) {
  const brightnessPct = attrs['brightness_pct'];
  if (typeof brightnessPct === 'number') {
    return Math.round(brightnessPct);
  }
  const brightness = attrs['brightness'];
  if (typeof brightness === 'number') {
    return Math.round((brightness / 255) * 100);
  }
  return null;
}

function getVolumePercent(attrs: Record<string, unknown>) {
  const volumeLevel = attrs['volume_level'];
  if (typeof volumeLevel === 'number') {
    return Math.round(volumeLevel * 100);
  }
  return null;
}

function formatTemperature(value: unknown) {
  if (typeof value === 'number') return `${value.toFixed(1)}°C`;
  const normalized = normalizeLabel(value);
  return normalized ? `${normalized}°C` : '—';
}

function readStringAttr(attrs: Record<string, unknown>, key: string) {
  const raw = attrs[key];
  return typeof raw === 'string' ? raw : null;
}
