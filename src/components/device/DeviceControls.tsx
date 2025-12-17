'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UIDevice } from '@/types/device';
import { getPrimaryLabel } from '@/lib/deviceLabels';

const CAMERA_REFRESH_INTERVAL_MS = 15000;

export type ControlPayload = {
  entityId: string;
  command: string;
  value?: number;
};

export function useDeviceCommand(onActionComplete?: () => void) {
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  const sendCommand = useCallback(
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
          throw new Error(data.error || `Failed with status ${res.status}`);
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

  return { pendingCommand, sendCommand };
}

type DeviceControlsProps = {
  device: UIDevice;
  onActionComplete?: () => void;
  relatedDevices?: UIDevice[];
};

export function DeviceControls({
  device,
  onActionComplete,
  relatedDevices,
}: DeviceControlsProps) {
  const label = getPrimaryLabel(device);
  const attrs = device.attributes || {};
  const { pendingCommand, sendCommand } = useDeviceCommand(onActionComplete);
  const brightnessValue = getBrightnessPercent(attrs);
  const volumeValue = getVolumePercent(attrs);
  const [brightnessPct, setBrightnessPct] = useState(brightnessValue ?? 0);
  const [volumePct, setVolumePct] = useState(volumeValue ?? 0);
  const [cameraRefreshToken, setCameraRefreshToken] = useState(() => Date.now());

  useEffect(() => {
    if (brightnessValue !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrightnessPct(brightnessValue);
    }
  }, [brightnessValue]);

  useEffect(() => {
    if (volumeValue !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVolumePct(volumeValue);
    }
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

  useEffect(() => {
    if (label === 'Doorbell' || label === 'Home Security') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCameraRefreshToken(Date.now());
    }
  }, [label]);

  const content = useMemo(() => {
    switch (label) {
      case 'Light':
        return renderLightControls({
          device,
          brightnessPct,
          supportsBrightness: brightnessValue !== null,
          setBrightnessPct,
          pendingCommand,
          sendCommand,
        });
      case 'Blind':
        return (
          <BlindControls
            device={device}
            pendingCommand={pendingCommand}
            sendCommand={sendCommand}
          />
        );
      case 'Spotify':
        return renderSpotifyControls({ device, pendingCommand, sendCommand });
      case 'Boiler':
        return renderBoilerControls({ device, pendingCommand, sendCommand });
      case 'Doorbell':
        return renderDoorbellControls({ device, cameraRefreshToken });
      case 'Home Security':
        return renderSecurityControls({
          relatedDevices,
          cameraRefreshToken,
        });
      case 'TV':
        return renderTvControls({
          device,
          volumePct,
          setVolumePct,
          pendingCommand,
          sendCommand,
        });
      case 'Speaker':
        return renderSpeakerControls({
          device,
          volumePct,
          setVolumePct,
          pendingCommand,
          sendCommand,
        });
      case 'Motion Sensor':
        return renderMotionSensorControls({ device });
      default:
        return (
          <p className="text-sm text-slate-500">
            No interactive controls available.
          </p>
        );
    }
  }, [
    label,
    device,
    brightnessPct,
    brightnessValue,
    volumePct,
    sendCommand,
    pendingCommand,
    cameraRefreshToken,
    relatedDevices,
  ]);

  return <div className="space-y-6">{content}</div>;
}

function renderLightControls({
  device,
  brightnessPct,
  supportsBrightness,
  setBrightnessPct,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  brightnessPct: number;
  supportsBrightness: boolean;
  setBrightnessPct: (value: number) => void;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const isOn = device.state === 'on';
  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() =>
          sendCommand({ entityId: device.entityId, command: 'light/toggle' })
        }
        disabled={pendingCommand !== null}
        className={`w-full rounded-2xl py-4 text-center text-lg font-semibold transition shadow-inner ${
          isOn
            ? 'bg-amber-400/80 text-amber-950 shadow-amber-200/60'
            : 'bg-slate-200/70 text-slate-600'
        }`}
      >
        {isOn ? 'Turn light off' : 'Turn light on'}
      </button>
      {device.domain === 'light' && supportsBrightness && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Brightness</span>
            <span className="text-base font-semibold text-slate-900">
              {brightnessPct}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={brightnessPct}
            onChange={(e) => setBrightnessPct(Number(e.target.value))}
            onMouseUp={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: 'light/set_brightness',
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            onTouchEnd={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: 'light/set_brightness',
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full accent-amber-500"
          />
        </div>
      )}
    </div>
  );
}

function BlindControls({
  device,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const attrs = device.attributes || {};
  const rawPosition =
    typeof attrs.current_position === 'number'
      ? (attrs.current_position as number)
      : typeof attrs.position === 'number'
      ? (attrs.position as number)
      : null;
  const position =
    rawPosition === null ? null : Math.round(Math.min(100, Math.max(0, rawPosition)));
  const [targetPosition, setTargetPosition] = useState(position ?? 0);

  useEffect(() => {
    if (position !== null) {
      setTargetPosition(position);
    }
  }, [position]);

  return (
    <div className="space-y-4">
      {position !== null && (
        <div className="text-sm text-slate-600">
          Current position:{' '}
          <span className="font-semibold text-slate-900">{position}% open</span>
        </div>
      )}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Target position</span>
          <span className="text-base font-semibold text-slate-900">
            {targetPosition}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={targetPosition}
          onChange={(e) => setTargetPosition(Number(e.target.value))}
          onMouseUp={(e) =>
            sendCommand({
              entityId: device.entityId,
              command: 'blind/set_position',
              value: Number((e.target as HTMLInputElement).value),
            })
          }
          onTouchEnd={(e) =>
            sendCommand({
              entityId: device.entityId,
              command: 'blind/set_position',
              value: Number((e.target as HTMLInputElement).value),
            })
          }
          disabled={pendingCommand !== null}
          className="w-full accent-sky-500"
        />
      </div>
    </div>
  );
}

function renderSpotifyControls({
  device,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const attrs = device.attributes || {};
  const cover = readImageAttr(attrs);
  const title = readStringAttr(attrs, 'media_title');
  const artist = readStringAttr(attrs, 'media_artist');
  const duration = readNumberAttr(attrs, 'media_duration');
  const position = readNumberAttr(attrs, 'media_position') ?? 0;
  const progressPct =
    duration && duration > 0
      ? Math.min(100, Math.round((position / duration) * 100))
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-full md:w-56 aspect-square rounded-3xl overflow-hidden bg-slate-900/10">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={title ?? device.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              No cover
            </div>
          )}
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <p className="text-xl font-semibold text-slate-900">
              {title || 'Nothing playing'}
            </p>
            {artist && <p className="text-sm text-slate-500">{artist}</p>}
          </div>
          <div>
            <div className="h-2 rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {duration !== null && (
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>{formatDuration(position)}</span>
                <span>-{formatDuration(duration - position)}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() =>
                sendCommand({
                  entityId: device.entityId,
                  command: 'media/previous',
                })
              }
              disabled={pendingCommand !== null}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() =>
                sendCommand({
                  entityId: device.entityId,
                  command: 'media/play_pause',
                })
              }
              disabled={pendingCommand !== null}
              className="rounded-full bg-emerald-500 px-6 py-2 text-sm font-semibold text-white shadow"
            >
              {device.state === 'playing' ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onClick={() =>
                sendCommand({
                  entityId: device.entityId,
                  command: 'media/next',
                })
              }
              disabled={pendingCommand !== null}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderBoilerControls({
  device,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const attrs = device.attributes || {};
  const target = attrs.temperature;
  const current = attrs.current_temperature;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
          Target
        </p>
        <p className="mt-2 text-5xl font-semibold text-slate-900">
          {formatTemperature(target)}
        </p>
        {current !== undefined && (
          <p className="mt-2 text-sm text-slate-500">
            Current {formatTemperature(current)}
          </p>
        )}
      </div>
      <div className="flex justify-center gap-4">
        <button
          type="button"
          onClick={() =>
            sendCommand({ entityId: device.entityId, command: 'boiler/temp_down' })
          }
          disabled={pendingCommand !== null}
          className="h-16 w-16 rounded-2xl border bg-white text-2xl shadow"
        >
          –
        </button>
        <button
          type="button"
          onClick={() =>
            sendCommand({ entityId: device.entityId, command: 'boiler/temp_up' })
          }
          disabled={pendingCommand !== null}
          className="h-16 w-16 rounded-2xl border bg-white text-2xl shadow"
        >
          +
        </button>
      </div>
    </div>
  );
}

function renderDoorbellControls({
  device,
  cameraRefreshToken,
}: {
  device: UIDevice;
  cameraRefreshToken: number;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/30 shadow-inner">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/camera-proxy?entityId=${encodeURIComponent(
          device.entityId
        )}&ts=${cameraRefreshToken}`}
        alt={device.name}
        className="h-[320px] w-full object-cover"
      />
    </div>
  );
}

function renderSecurityControls({
  relatedDevices,
  cameraRefreshToken,
}: {
  relatedDevices?: UIDevice[];
  cameraRefreshToken: number;
}) {
  if (!relatedDevices || relatedDevices.length === 0) {
    return <p className="text-sm text-slate-500">No cameras available.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {relatedDevices.map((device) => (
        <div
          key={device.entityId}
          className="overflow-hidden rounded-2xl border border-white/30"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/camera-proxy?entityId=${encodeURIComponent(
              device.entityId
            )}&ts=${cameraRefreshToken}`}
            alt={device.name}
            className="h-48 w-full object-cover"
          />
          <div className="bg-white/80 px-4 py-2 text-sm text-slate-600">
            {device.name}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderTvControls({
  device,
  volumePct,
  setVolumePct,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  volumePct: number;
  setVolumePct: (value: number) => void;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() =>
          sendCommand({ entityId: device.entityId, command: 'tv/toggle_power' })
        }
        disabled={pendingCommand !== null}
        className={`w-full rounded-2xl py-4 text-lg font-semibold ${
          device.state === 'off'
            ? 'bg-slate-200 text-slate-600'
            : 'bg-indigo-500/90 text-white'
        }`}
      >
        {device.state === 'off' ? 'Power on' : 'Power off'}
      </button>
      <div>
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Volume</span>
          <span className="text-base font-semibold text-slate-900">
            {volumePct}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={volumePct}
          onChange={(e) => setVolumePct(Number(e.target.value))}
          onMouseUp={(e) =>
            sendCommand({
              entityId: device.entityId,
              command: 'media/volume_set',
              value: Number((e.target as HTMLInputElement).value),
            })
          }
          onTouchEnd={(e) =>
            sendCommand({
              entityId: device.entityId,
              command: 'media/volume_set',
              value: Number((e.target as HTMLInputElement).value),
            })
          }
          className="w-full accent-indigo-500"
        />
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() =>
              sendCommand({
                entityId: device.entityId,
                command: 'media/volume_down',
              })
            }
            disabled={pendingCommand !== null}
            className="flex-1 rounded-2xl border border-slate-200 py-3"
          >
            Volume -
          </button>
          <button
            type="button"
            onClick={() =>
              sendCommand({
                entityId: device.entityId,
                command: 'media/volume_up',
              })
            }
            disabled={pendingCommand !== null}
            className="flex-1 rounded-2xl border border-slate-200 py-3"
          >
            Volume +
          </button>
        </div>
      </div>
    </div>
  );
}

function renderSpeakerControls({
  device,
  volumePct,
  setVolumePct,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  volumePct: number;
  setVolumePct: (value: number) => void;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() =>
          sendCommand({
            entityId: device.entityId,
            command: 'speaker/toggle_power',
          })
        }
        disabled={pendingCommand !== null}
        className={`w-full rounded-2xl py-4 text-lg font-semibold ${
          device.state === 'off'
            ? 'bg-slate-200 text-slate-600'
            : 'bg-purple-500/90 text-white'
        }`}
      >
        {device.state === 'off' ? 'Power on' : 'Power off'}
      </button>
      <div>
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Volume</span>
          <span className="text-base font-semibold text-slate-900">
            {volumePct}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={volumePct}
          onChange={(e) => setVolumePct(Number(e.target.value))}
          onMouseUp={(e) =>
            sendCommand({
              entityId: device.entityId,
              command: 'media/volume_set',
              value: Number((e.target as HTMLInputElement).value),
            })
          }
          onTouchEnd={(e) =>
            sendCommand({
              entityId: device.entityId,
              command: 'media/volume_set',
              value: Number((e.target as HTMLInputElement).value),
            })
          }
          className="w-full accent-purple-500"
        />
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() =>
              sendCommand({
                entityId: device.entityId,
                command: 'media/volume_down',
              })
            }
            disabled={pendingCommand !== null}
            className="flex-1 rounded-2xl border border-slate-200 py-3"
          >
            Volume -
          </button>
          <button
            type="button"
            onClick={() =>
              sendCommand({
                entityId: device.entityId,
                command: 'media/volume_up',
              })
            }
            disabled={pendingCommand !== null}
            className="flex-1 rounded-2xl border border-slate-200 py-3"
          >
            Volume +
          </button>
        </div>
      </div>
    </div>
  );
}

function renderMotionSensorControls({ device }: { device: UIDevice }) {
  const normalized = device.state.toLowerCase();
  const isActive =
    normalized === 'on' ||
    normalized === 'open' ||
    normalized === 'detected' ||
    normalized === 'motion';

  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <div
        className={`flex h-28 w-28 items-center justify-center rounded-full text-3xl ${
          isActive ? 'bg-emerald-200 text-emerald-700' : 'bg-slate-200 text-slate-500'
        }`}
      >
        {isActive ? '●' : '○'}
      </div>
      <p className="text-lg font-semibold text-slate-900">
        {isActive ? 'Motion detected' : 'No motion'}
      </p>
    </div>
  );
}

export function getBrightnessPercent(attrs: Record<string, unknown>) {
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

export function getVolumePercent(attrs: Record<string, unknown>) {
  const volumeLevel = attrs['volume_level'];
  if (typeof volumeLevel === 'number') {
    return Math.round(volumeLevel * 100);
  }
  return null;
}

export function formatTemperature(value: unknown) {
  if (typeof value === 'number') return `${value.toFixed(1)}°C`;
  return '—';
}

function formatDuration(seconds?: number | null) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.max(0, Math.round(seconds % 60));
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function readStringAttr(attrs: Record<string, unknown>, key: string) {
  const raw = attrs[key];
  return typeof raw === 'string' ? raw : null;
}

function readNumberAttr(attrs: Record<string, unknown>, key: string) {
  const raw = attrs[key];
  return typeof raw === 'number' ? raw : null;
}

function readImageAttr(attrs: Record<string, unknown>) {
  const local = readStringAttr(attrs, 'entity_picture_local');
  if (local) return local;
  return readStringAttr(attrs, 'entity_picture');
}
