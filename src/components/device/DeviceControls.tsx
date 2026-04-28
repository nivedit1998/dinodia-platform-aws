'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UIDevice } from '@/types/device';
import { getPrimaryLabel } from '@/lib/deviceLabels';
import {
  DeviceServiceSpec,
  DeviceActionSpec,
  DeviceCommandId,
  getAdvancedServicesForDevice,
  getActionsForDevice,
  getBlindPosition,
  getBrightnessPercent,
  getCurrentTemperature,
  getTargetTemperature,
  getVolumePercent,
} from '@/lib/deviceCapabilities';

const CAMERA_REFRESH_INTERVAL_MS = 15000;

export type ControlPayload = {
  entityId: string;
  command?: string;
  serviceId?: string;
  serviceData?: Record<string, unknown>;
  value?: number;
};

export function useDeviceCommand(onActionComplete?: () => void, enabled = true) {
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  const sendCommand = useCallback(
    async (payload: ControlPayload) => {
      if (!enabled) return;
      const pendingKey = payload.command ?? payload.serviceId ?? 'service';
      setPendingCommand(pendingKey);
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
    [enabled, onActionComplete]
  );

  return { pendingCommand, sendCommand };
}

type ActionMap = {
  powerOn?: DeviceCommandId;
  powerOff?: DeviceCommandId;
  toggle?: DeviceCommandId;
  brightness?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  blindSlider?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  blindPositions?: Extract<DeviceActionSpec, { kind: 'fixed-position' }>;
  blindOpen?: DeviceCommandId;
  blindClose?: DeviceCommandId;
  volume?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  volumeUp?: DeviceCommandId;
  volumeDown?: DeviceCommandId;
  boilerTempUp?: DeviceCommandId;
  boilerTempDown?: DeviceCommandId;
  setTemperature?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  playPause?: DeviceCommandId;
  next?: DeviceCommandId;
  previous?: DeviceCommandId;
};

function buildActionMap(actions: DeviceActionSpec[]): ActionMap {
  const map: ActionMap = {};
  actions.forEach((action) => {
    if (action.kind === 'command') {
      switch (action.id) {
        case 'light/turn_on':
        case 'tv/turn_on':
        case 'speaker/turn_on':
          map.powerOn = action.id;
          break;
        case 'light/turn_off':
        case 'tv/turn_off':
        case 'speaker/turn_off':
          map.powerOff = action.id;
          break;
        case 'media/volume_up':
          map.volumeUp = action.id;
          break;
        case 'media/volume_down':
          map.volumeDown = action.id;
          break;
        case 'boiler/temp_up':
          map.boilerTempUp = action.id;
          break;
        case 'boiler/temp_down':
          map.boilerTempDown = action.id;
          break;
        case 'media/play_pause':
          map.playPause = action.id;
          break;
        case 'media/next':
          map.next = action.id;
          break;
        case 'media/previous':
          map.previous = action.id;
          break;
        case 'light/toggle':
          map.toggle = action.id;
          break;
        case 'blind/open':
          map.blindOpen = action.id;
          break;
        case 'blind/close':
          map.blindClose = action.id;
          break;
        default:
          break;
      }
    } else if (action.kind === 'slider') {
      if (action.id === 'light/set_brightness') map.brightness = action;
      if (action.id === 'blind/set_position') map.blindSlider = action;
      if (action.id === 'media/volume_set') map.volume = action;
      if (action.id === 'boiler/set_temperature') map.setTemperature = action;
    } else if (action.kind === 'fixed-position') {
      if (action.id === 'blind/set_position') map.blindPositions = action;
    }
  });
  return map;
}

function isPowerOn(label: string, state: string) {
  const normalized = state.toLowerCase();
  if (label === 'TV' || label === 'Speaker') {
    return normalized !== 'off' && normalized !== 'standby';
  }
  return normalized === 'on';
}

type DeviceControlsProps = {
  device: UIDevice;
  onActionComplete?: () => void;
  relatedDevices?: UIDevice[];
  allowDeviceControl?: boolean;
};

export function DeviceControls({
  device,
  onActionComplete,
  relatedDevices,
  allowDeviceControl = true,
}: DeviceControlsProps) {
  const label = getPrimaryLabel(device);
  const attrs = device.attributes || {};
  const actions = useMemo(() => getActionsForDevice(device, 'dashboard'), [device]);
  const advancedServices = useMemo(() => getAdvancedServicesForDevice(device), [device]);
  const actionMap = useMemo(() => buildActionMap(actions), [actions]);
  const { pendingCommand, sendCommand } = useDeviceCommand(
    onActionComplete,
    allowDeviceControl
  );
  const brightnessValue = getBrightnessPercent(attrs);
  const volumeValue = getVolumePercent(attrs);
  const blindPosition = getBlindPosition(attrs);
  const [brightnessPct, setBrightnessPct] = useState(brightnessValue ?? 0);
  const [volumePct, setVolumePct] = useState(volumeValue ?? 0);
  const [targetPosition, setTargetPosition] = useState(blindPosition ?? 0);
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
    if (blindPosition !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTargetPosition(blindPosition);
    }
  }, [blindPosition]);

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
    const hasPlayback =
      !!actionMap.playPause || !!actionMap.next || !!actionMap.previous;
    const hasVolume =
      !!actionMap.volume || !!actionMap.volumeUp || !!actionMap.volumeDown;
    const hasPower = !!actionMap.powerOn || !!actionMap.powerOff || !!actionMap.toggle;
    const hasBlind =
      !!actionMap.blindSlider || !!actionMap.blindPositions || !!actionMap.blindOpen || !!actionMap.blindClose;
    const hasBoiler =
      !!actionMap.boilerTempUp || !!actionMap.boilerTempDown || !!actionMap.setTemperature;

    if (label === 'Doorbell') {
      return renderDoorbellControls({ device, cameraRefreshToken });
    }
    if (label === 'Home Security') {
      return renderSecurityControls({
        relatedDevices,
        cameraRefreshToken,
      });
    }
    if (label === 'Motion Sensor') {
      return renderMotionSensorControls({ device });
    }
    if (hasBlind) {
      return (
        <BlindControls
          device={device}
          position={blindPosition}
          targetPosition={targetPosition}
          setTargetPosition={setTargetPosition}
          sliderAction={actionMap.blindSlider}
          openCommand={actionMap.blindOpen}
          closeCommand={actionMap.blindClose}
          pendingCommand={pendingCommand}
          sendCommand={sendCommand}
        />
      );
    }
    if (hasBoiler) {
      return renderBoilerControls({
        device,
        pendingCommand,
        sendCommand,
        tempUp: actionMap.boilerTempUp,
        tempDown: actionMap.boilerTempDown,
        setTemperature: actionMap.setTemperature,
      });
    }
    if (hasPlayback) {
      return renderSpotifyControls({
        device,
        pendingCommand,
        sendCommand,
        playPause: actionMap.playPause,
        next: actionMap.next,
        previous: actionMap.previous,
      });
    }
    if (hasVolume && hasPower) {
      return renderTvControls({
        device,
        volumePct,
        setVolumePct,
        pendingCommand,
        sendCommand,
        powerOn: actionMap.powerOn,
        powerOff: actionMap.powerOff,
        volumeAction: actionMap.volume,
        volumeUp: actionMap.volumeUp,
        volumeDown: actionMap.volumeDown,
      });
    }
    if (hasPower || actionMap.brightness) {
      return renderLightControls({
        device,
        brightnessPct,
        brightnessAction: actionMap.brightness,
        setBrightnessPct,
        powerOn: actionMap.powerOn,
        powerOff: actionMap.powerOff,
        toggle: actionMap.toggle,
        pendingCommand,
        sendCommand,
      });
    }
    switch (label) {
      case 'Doorbell':
        return renderDoorbellControls({ device, cameraRefreshToken });
      case 'Home Security':
        return renderSecurityControls({
          relatedDevices,
          cameraRefreshToken,
        });
      default:
        return (
          <p className="text-sm text-slate-500">
            No interactive controls available.
          </p>
        );
    }
  }, [
    actionMap,
    blindPosition,
    brightnessPct,
    cameraRefreshToken,
    device,
    label,
    pendingCommand,
    relatedDevices,
    sendCommand,
    targetPosition,
    volumePct,
  ]);

  return (
    <div className="space-y-6">
      {allowDeviceControl ? (
        <>
          {content}
          <AdvancedServicesSection
            device={device}
            services={advancedServices}
            pendingCommand={pendingCommand}
            sendCommand={sendCommand}
          />
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Device control is available to tenants only.
          </p>
        </div>
      )}
    </div>
  );
}

function renderLightControls({
  device,
  brightnessPct,
  brightnessAction,
  setBrightnessPct,
  powerOn,
  powerOff,
  toggle,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  brightnessPct: number;
  brightnessAction?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  setBrightnessPct: (value: number) => void;
  powerOn?: DeviceCommandId;
  powerOff?: DeviceCommandId;
  toggle?: DeviceCommandId;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const hasPowerCommands = !!powerOn || !!powerOff || !!toggle;
  const isOn = isPowerOn('Light', device.state);

  if (!hasPowerCommands && !brightnessAction) {
    return (
      <p className="text-sm text-slate-500">
        No interactive controls available.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {hasPowerCommands && (
        <button
          type="button"
          onClick={() =>
            sendCommand({
              entityId: device.entityId,
              command: isOn ? powerOff ?? toggle! : powerOn ?? toggle!,
            })
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
      )}
      {device.domain === 'light' && brightnessAction && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Brightness</span>
            <span className="text-base font-semibold text-slate-900">
              {brightnessPct}%
            </span>
          </div>
          <input
            type="range"
            min={brightnessAction.min}
            max={brightnessAction.max}
            step={brightnessAction.step ?? 1}
            value={brightnessPct}
            onChange={(e) => setBrightnessPct(Number(e.target.value))}
            onMouseUp={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: brightnessAction.id,
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            onTouchEnd={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: brightnessAction.id,
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
  position,
  targetPosition,
  setTargetPosition,
  sliderAction,
  openCommand,
  closeCommand,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  position: number | null;
  targetPosition: number;
  setTargetPosition: (value: number) => void;
  sliderAction?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  openCommand?: DeviceCommandId;
  closeCommand?: DeviceCommandId;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  if (!sliderAction && !openCommand && !closeCommand) {
    return (
      <p className="text-sm text-slate-500">No interactive controls available.</p>
    );
  }

  return (
    <div className="space-y-4">
      {(openCommand || closeCommand) && (
        <div className="flex gap-3">
          {openCommand && (
            <button
              type="button"
              onClick={() => sendCommand({ entityId: device.entityId, command: openCommand })}
              disabled={pendingCommand !== null}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm"
            >
              Open
            </button>
          )}
          {closeCommand && (
            <button
              type="button"
              onClick={() => sendCommand({ entityId: device.entityId, command: closeCommand })}
              disabled={pendingCommand !== null}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm"
            >
              Close
            </button>
          )}
        </div>
      )}
      {position !== null && (
        <div className="text-sm text-slate-600">
          Current position:{' '}
          <span className="font-semibold text-slate-900">{position}% open</span>
        </div>
      )}
      {sliderAction && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Target position</span>
            <span className="text-base font-semibold text-slate-900">
              {targetPosition}%
            </span>
          </div>
          <input
            type="range"
            min={sliderAction.min}
            max={sliderAction.max}
            step={sliderAction.step ?? 1}
            value={targetPosition}
            onChange={(e) => setTargetPosition(Number(e.target.value))}
            onMouseUp={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: sliderAction.id,
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            onTouchEnd={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: sliderAction.id,
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            disabled={pendingCommand !== null}
            className="w-full accent-sky-500"
          />
        </div>
      )}
    </div>
  );
}

function renderSpotifyControls({
  device,
  playPause,
  next,
  previous,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  playPause?: DeviceCommandId;
  next?: DeviceCommandId;
  previous?: DeviceCommandId;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  if (!playPause || !next || !previous) {
    return <p className="text-sm text-slate-500">No interactive controls available.</p>;
  }

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
                  command: previous,
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
                  command: playPause,
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
                  command: next,
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
  tempUp,
  tempDown,
  setTemperature,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  tempUp?: DeviceCommandId;
  tempDown?: DeviceCommandId;
  setTemperature?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  if (!tempUp || !tempDown) {
    return <p className="text-sm text-slate-500">No interactive controls available.</p>;
  }

  const attrs = device.attributes || {};
  const target = getTargetTemperature(attrs);
  const current = getCurrentTemperature(attrs);

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
            sendCommand({ entityId: device.entityId, command: tempDown })
          }
          disabled={pendingCommand !== null}
          className="h-16 w-16 rounded-2xl border bg-white text-2xl shadow"
        >
          –
        </button>
        <button
          type="button"
          onClick={() =>
            sendCommand({ entityId: device.entityId, command: tempUp })
          }
          disabled={pendingCommand !== null}
          className="h-16 w-16 rounded-2xl border bg-white text-2xl shadow"
        >
          +
        </button>
      </div>
      {setTemperature && (
        <BoilerTemperatureSlider
          device={device}
          action={setTemperature}
          pendingCommand={pendingCommand}
          sendCommand={sendCommand}
        />
      )}
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
  powerOn,
  powerOff,
  volumeAction,
  volumeUp,
  volumeDown,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  volumePct: number;
  setVolumePct: (value: number) => void;
  powerOn?: DeviceCommandId;
  powerOff?: DeviceCommandId;
  volumeAction?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  volumeUp?: DeviceCommandId;
  volumeDown?: DeviceCommandId;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const hasPower = !!powerOn && !!powerOff;
  const isOn = hasPower ? isPowerOn('TV', device.state) : false;
  const hasVolumeControls = !!volumeAction;

  if (!hasPower && !hasVolumeControls) {
    return <p className="text-sm text-slate-500">No interactive controls available.</p>;
  }

  return (
    <div className="space-y-5">
      {hasPower && (
        <button
          type="button"
          onClick={() =>
            sendCommand({ entityId: device.entityId, command: isOn ? powerOff! : powerOn! })
          }
          disabled={pendingCommand !== null}
          className={`w-full rounded-2xl py-4 text-lg font-semibold ${
            isOn ? 'bg-indigo-500/90 text-white' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {isOn ? 'Power off' : 'Power on'}
        </button>
      )}
      {hasVolumeControls && (
        <div>
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Volume</span>
            <span className="text-base font-semibold text-slate-900">
              {volumePct}%
            </span>
          </div>
          <input
            type="range"
            min={volumeAction?.min ?? 0}
            max={volumeAction?.max ?? 100}
            step={volumeAction?.step ?? 1}
            value={volumePct}
            onChange={(e) => setVolumePct(Number(e.target.value))}
            onMouseUp={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: volumeAction!.id,
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            onTouchEnd={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: volumeAction!.id,
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full accent-indigo-500"
          />
          {volumeDown && volumeUp && (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() =>
                  sendCommand({
                    entityId: device.entityId,
                    command: volumeDown,
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
                    command: volumeUp,
                  })
                }
                disabled={pendingCommand !== null}
                className="flex-1 rounded-2xl border border-slate-200 py-3"
              >
                Volume +
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderSpeakerControls({
  device,
  volumePct,
  setVolumePct,
  powerOn,
  powerOff,
  volumeAction,
  volumeUp,
  volumeDown,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  volumePct: number;
  setVolumePct: (value: number) => void;
  powerOn?: DeviceCommandId;
  powerOff?: DeviceCommandId;
  volumeAction?: Extract<DeviceActionSpec, { kind: 'slider' }>;
  volumeUp?: DeviceCommandId;
  volumeDown?: DeviceCommandId;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const hasPower = !!powerOn && !!powerOff;
  const isOn = hasPower ? isPowerOn('Speaker', device.state) : false;
  const hasVolumeControls = !!volumeAction;

  if (!hasPower && !hasVolumeControls) {
    return <p className="text-sm text-slate-500">No interactive controls available.</p>;
  }

  return (
    <div className="space-y-5">
      {hasPower && (
        <button
          type="button"
          onClick={() =>
            sendCommand({
              entityId: device.entityId,
              command: isOn ? powerOff! : powerOn!,
            })
          }
          disabled={pendingCommand !== null}
          className={`w-full rounded-2xl py-4 text-lg font-semibold ${
            isOn ? 'bg-purple-500/90 text-white' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {isOn ? 'Power off' : 'Power on'}
        </button>
      )}
      {hasVolumeControls && (
        <div>
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>Volume</span>
            <span className="text-base font-semibold text-slate-900">
              {volumePct}%
            </span>
          </div>
          <input
            type="range"
            min={volumeAction?.min ?? 0}
            max={volumeAction?.max ?? 100}
            step={volumeAction?.step ?? 1}
            value={volumePct}
            onChange={(e) => setVolumePct(Number(e.target.value))}
            onMouseUp={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: volumeAction!.id,
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            onTouchEnd={(e) =>
              sendCommand({
                entityId: device.entityId,
                command: volumeAction!.id,
                value: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full accent-purple-500"
          />
          {volumeDown && volumeUp && (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() =>
                  sendCommand({
                    entityId: device.entityId,
                    command: volumeDown,
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
                    command: volumeUp,
                  })
                }
                disabled={pendingCommand !== null}
                className="flex-1 rounded-2xl border border-slate-200 py-3"
              >
                Volume +
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BoilerTemperatureSlider({
  device,
  action,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  action: Extract<DeviceActionSpec, { kind: 'slider' }>;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const attrs = device.attributes || {};
  const target = getTargetTemperature(attrs) ?? action.min;
  const [value, setValue] = useState(target);

  useEffect(() => {
    setValue(target);
  }, [target]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>Set temperature</span>
        <span className="text-base font-semibold text-slate-900">
          {Math.round(value)}°
        </span>
      </div>
      <input
        type="range"
        min={action.min}
        max={action.max}
        step={action.step ?? 1}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onMouseUp={(e) =>
          sendCommand({
            entityId: device.entityId,
            command: action.id,
            value: Number((e.target as HTMLInputElement).value),
          })
        }
        onTouchEnd={(e) =>
          sendCommand({
            entityId: device.entityId,
            command: action.id,
            value: Number((e.target as HTMLInputElement).value),
          })
        }
        disabled={pendingCommand !== null}
        className="w-full accent-rose-500"
      />
    </div>
  );
}

function AdvancedServicesSection({
  device,
  services,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  services: DeviceServiceSpec[];
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  if (services.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <p className="text-sm font-semibold text-slate-900">Advanced actions</p>
      <div className="space-y-3">
        {services.map((service) => (
          <AdvancedServiceRow
            key={service.serviceId}
            device={device}
            service={service}
            pendingCommand={pendingCommand}
            sendCommand={sendCommand}
          />
        ))}
      </div>
    </div>
  );
}

function AdvancedServiceRow({
  device,
  service,
  pendingCommand,
  sendCommand,
}: {
  device: UIDevice;
  service: DeviceServiceSpec;
  pendingCommand: string | null;
  sendCommand: (payload: ControlPayload) => Promise<void>;
}) {
  const [jsonValue, setJsonValue] = useState('{}');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-800">{service.serviceId}</span>
        <button
          type="button"
          onClick={() => {
            try {
              const parsed = jsonValue.trim() ? JSON.parse(jsonValue) : {};
              setError(null);
              void sendCommand({
                entityId: device.entityId,
                serviceId: service.serviceId,
                serviceData: parsed,
              });
            } catch {
              setError('Invalid JSON');
            }
          }}
          disabled={pendingCommand !== null}
          className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
        >
          Run
        </button>
      </div>
      <textarea
        value={jsonValue}
        onChange={(e) => setJsonValue(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
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
