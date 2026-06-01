'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ProvisionOkResponse = { ok: true; serial: string; bootstrapSecret: string; homeId: number; hubInstallId: string };
type ProvisionResponseV2 = ProvisionOkResponse | { ok?: false; error?: string };

type RoomRow = {
  id: string;
  displayName: string;
  haAreaName: string;
  haAreaNameOriginal: string;
  qrKeyVersion: number;
  status: string;
  qrPayload: string;
};

export default function ProvisionClient({ installerName }: { installerName: string }) {
  const router = useRouter();
  const [serial, setSerial] = useState('');
  const [bootstrapSecret, setBootstrapSecret] = useState<string | null>(null);
  const [hubInstallId, setHubInstallId] = useState<string | null>(null);
  const [haBaseUrl, setHaBaseUrl] = useState('');
  const [haCloudUrl, setHaCloudUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [haUser, setHaUser] = useState('');
  const [haPass, setHaPass] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [haAreas, setHaAreas] = useState<string[]>([]);
  const [rooms, setRooms] = useState<Array<RoomRow & { qrDataUrl?: string | null }>>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [newRoomDisplayName, setNewRoomDisplayName] = useState('');
  const [newRoomHaAreaName, setNewRoomHaAreaName] = useState('');
  const [addingRoom, setAddingRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [deviceLabel] = useState(() => getDeviceLabel());

  function normalizeBaseUrl(value: string) {
    const trimmed = value.trim();
    return trimmed.replace(/\/+$/, '');
  }

  function normalizeCloudUrl(value: string) {
    const trimmed = value.trim();
    return trimmed.replace(/\/+$/, '');
  }

  function buildPayload(secret: string) {
    const query = new URLSearchParams({
      v: '3',
      s: serial.trim(),
      bs: secret.trim(),
    });
    return `dinodia://hub?${query.toString()}`;
  }

  async function generateQr(secret: string) {
    setQrError(null);
    setQrDataUrl(null);
    setQrPayload(null);

    const payload = buildPayload(secret);
    try {
      const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
      });
      setQrPayload(payload);
      setQrDataUrl(dataUrl);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Unable to generate QR code.');
    }
  }

  async function generateRoomQrDataUrl(payload: string) {
    return QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
    });
  }

  async function loadHaAreas(targetHubInstallId: string) {
    const res = await fetch(`/api/installer/hubs/${encodeURIComponent(targetHubInstallId)}/ha-areas`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const areas: string[] = Array.isArray(data.areas) ? data.areas.filter((a: unknown) => typeof a === 'string') : [];
    setHaAreas(areas);
    if (!newRoomHaAreaName && areas.length > 0) {
      setNewRoomHaAreaName(areas[0]);
    }
  }

  async function loadRooms(targetHubInstallId: string) {
    setRoomsError(null);
    setRoomsLoading(true);
    try {
      const res = await fetch(`/api/installer/hubs/${encodeURIComponent(targetHubInstallId)}/rooms`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setRoomsError((data && typeof data.error === 'string' ? data.error : null) || 'Unable to load rooms.');
        return;
      }
      const list: RoomRow[] = Array.isArray(data.rooms) ? data.rooms : [];
      const withQr = await Promise.all(
        list.map(async (room) => {
          try {
            const roomQrDataUrl = await generateRoomQrDataUrl(room.qrPayload);
            return { ...room, qrDataUrl: roomQrDataUrl };
          } catch {
            return { ...room, qrDataUrl: null };
          }
        })
      );
      setRooms(withQr);
    } finally {
      setRoomsLoading(false);
    }
  }

  useEffect(() => {
    if (!hubInstallId) return;
    void loadHaAreas(hubInstallId);
    void loadRooms(hubInstallId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubInstallId]);

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBootstrapSecret(null);
    setHubInstallId(null);
    setQrDataUrl(null);
    setQrPayload(null);
    setQrError(null);
    setRooms([]);
    setHaAreas([]);
    setNewRoomDisplayName('');
    setNewRoomHaAreaName('');
    if (!serial.trim()) {
      setError('Enter a serial.');
      return;
    }
    if (!deviceId) {
      setError('Preparing device info. Try again in a moment.');
      return;
    }
    if (!haBaseUrl.trim() || !haCloudUrl.trim() || !haToken.trim() || !haUser.trim() || !haPass.trim()) {
      setError('Enter HA admin credentials, base URL, cloud URL, and long-lived token.');
      return;
    }
    if (!/^https?:\/\//i.test(haBaseUrl.trim())) {
      setError('Base URL must start with http:// or https://');
      return;
    }
    try {
      const parsed = new URL(haCloudUrl.trim());
      if (parsed.protocol !== 'https:') {
        throw new Error('Cloud URL must start with https://');
      }
      if (!parsed.hostname.toLowerCase().endsWith('.dinodiasmartliving.com')) {
        throw new Error('Cloud URL must end with .dinodiasmartliving.com');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enter a valid cloud URL (https://xxx.dinodiasmartliving.com).');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/installer/hubs/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': deviceId,
        'x-device-label': deviceLabel,
      },
      body: JSON.stringify({
        serial: serial.trim(),
        haBaseUrl: normalizeBaseUrl(haBaseUrl),
        haCloudUrl: normalizeCloudUrl(haCloudUrl),
        haLongLivedToken: haToken.trim(),
        haUsername: haUser.trim(),
        haPassword: haPass,
      }),
    });
    const data: ProvisionResponseV2 = await res.json().catch(() => ({ ok: false, error: 'Invalid response' }));
    setLoading(false);

    if (!res.ok || !data.ok) {
      const errMsg = (data as { error?: string }).error;
      setError(errMsg || 'Provisioning failed. Check the serial or try again.');
      return;
    }

    setBootstrapSecret(data.bootstrapSecret);
    setHubInstallId(data.hubInstallId);
    await generateQr(data.bootstrapSecret);
  }

  async function handleAddRoom(e: React.FormEvent) {
    e.preventDefault();
    setRoomsError(null);
    if (!hubInstallId) return;
    const displayName = newRoomDisplayName.trim();
    const haAreaName = newRoomHaAreaName.trim();
    if (!displayName || !haAreaName) {
      setRoomsError('Enter a room name and choose a Home Assistant area.');
      return;
    }
    setAddingRoom(true);
    try {
      const res = await fetch(`/api/installer/hubs/${encodeURIComponent(hubInstallId)}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, haAreaName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setRoomsError((data && typeof data.error === 'string' ? data.error : null) || 'Unable to add room.');
        return;
      }
      setNewRoomDisplayName('');
      await loadRooms(hubInstallId);
    } finally {
      setAddingRoom(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/installer/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Signed in as</p>
            <p className="text-lg font-semibold text-slate-900">{installerName}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/installer/HomeSupport"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Home Support
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Logout
            </button>
          </div>
        </header>

        <div className="rounded-xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
          <h1 className="text-2xl font-semibold text-slate-900">Provision a Dinodia Hub</h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter the Dinodia Serial Number. You&apos;ll get a bootstrap secret to paste into the hub add-on and a QR to share with the homeowner.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleProvision}>
            <div>
              <label className="block text-sm font-medium text-slate-700">Dinodia Serial Number</label>
              <input
                type="text"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="e.g. DIN-GB-00001234"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">HA Admin Username</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  value={haUser}
                  onChange={(e) => setHaUser(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">HA Admin Password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  value={haPass}
                  onChange={(e) => setHaPass(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
              <label className="block text-sm font-medium text-slate-700">Base URL</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                value={haBaseUrl}
                onChange={(e) => setHaBaseUrl(e.target.value)}
                placeholder="http://homeassistant.local:8123"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Cloud URL (Dinodia Cloudflare)</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                value={haCloudUrl}
                onChange={(e) => setHaCloudUrl(e.target.value)}
                placeholder="https://xxx.dinodiasmartliving.com"
                autoComplete="off"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Must start with https:// and end with .dinodiasmartliving.com
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Long-lived access token</label>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                  value={haToken}
                  onChange={(e) => setHaToken(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}
            {qrError && <p className="text-sm text-rose-600">{qrError}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? 'Provisioning…' : 'Provision hub'}
            </button>

            {bootstrapSecret && (
              <button
                type="button"
                onClick={() => generateQr(bootstrapSecret)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Generate / update QR
              </button>
            )}
          </form>

          {bootstrapSecret && (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">Bootstrap secret (copy and store safely):</p>
              <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs text-slate-900">
                {bootstrapSecret}
              </code>
            </div>
          )}

          {qrPayload && (
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-semibold text-slate-800">Share with homeowner</h2>
              <p className="text-xs text-slate-600 mt-1">QR includes only the Dinodia serial and bootstrap secret (no HA credentials).</p>
              {qrDataUrl && (
                <div className="mt-3 flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="Dinodia hub QR"
                    className="w-40 h-40 rounded-lg border border-slate-200 bg-white"
                  />
                  <a
                    href={qrDataUrl}
                    download="dinodia-hub-qr.png"
                    className="text-indigo-600 hover:underline text-xs font-medium"
                  >
                    Download QR
                  </a>
                </div>
              )}
              <div className="mt-3 rounded-md bg-white border border-slate-200 p-3 text-[11px] text-slate-700 break-all">
                {qrPayload}
              </div>
            </div>
          )}

          {hubInstallId ? (
            <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Rooms / Areas</h2>
              <p className="mt-1 text-xs text-slate-600">
                Create permanent room QR codes for this hub. Use Home Assistant area names so tenant access matches HA.
              </p>

              <form onSubmit={handleAddRoom} className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="md:col-span-1">
                  <label className="block text-xs font-medium text-slate-700">Room display name</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-500 focus:outline-none"
                    value={newRoomDisplayName}
                    onChange={(e) => setNewRoomDisplayName(e.target.value)}
                    placeholder="e.g. Room 1"
                    required
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-xs font-medium text-slate-700">Home Assistant area</label>
                  {haAreas.length > 0 ? (
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-500 focus:outline-none"
                      value={newRoomHaAreaName}
                      onChange={(e) => setNewRoomHaAreaName(e.target.value)}
                      required
                    >
                      {haAreas.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-500 focus:outline-none"
                      value={newRoomHaAreaName}
                      onChange={(e) => setNewRoomHaAreaName(e.target.value)}
                      placeholder="e.g. Bedroom"
                      required
                    />
                  )}
                </div>
                <div className="md:col-span-1 flex items-end">
                  <button
                    type="submit"
                    disabled={addingRoom}
                    className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {addingRoom ? 'Adding…' : 'Add room'}
                  </button>
                </div>
              </form>

              {roomsError ? <p className="mt-3 text-xs text-rose-600">{roomsError}</p> : null}

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadRooms(hubInstallId)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Refresh rooms
                </button>
              </div>

              {roomsLoading ? (
                <p className="mt-3 text-xs text-slate-500">Loading rooms…</p>
              ) : rooms.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No rooms created yet.</p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {rooms.map((room) => (
                    <div key={room.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{room.displayName}</p>
                          <p className="mt-1 text-[11px] text-slate-600">
                            HA area: <span className="font-medium">{room.haAreaName}</span>
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Original: {room.haAreaNameOriginal} • Key v{room.qrKeyVersion}
                          </p>
                        </div>
                        {room.qrDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={room.qrDataUrl}
                            alt={`${room.displayName} QR`}
                            className="h-24 w-24 rounded-lg border border-slate-200 bg-white"
                          />
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          onClick={async () => {
                            if (!hubInstallId) return;
                            await fetch(
                              `/api/installer/hubs/${encodeURIComponent(hubInstallId)}/rooms/${encodeURIComponent(room.id)}/rekey`,
                              { method: 'POST' }
                            ).catch(() => null);
                            await loadRooms(hubInstallId);
                          }}
                        >
                          Re-key QR
                        </button>
                      </div>

                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Resync HA area
                        </label>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-500 focus:outline-none"
                          defaultValue={room.haAreaName}
                          onChange={async (e) => {
                            if (!hubInstallId) return;
                            const next = e.target.value;
                            await fetch(
                              `/api/installer/hubs/${encodeURIComponent(hubInstallId)}/rooms/${encodeURIComponent(room.id)}/resync`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ haAreaName: next }),
                              }
                            ).catch(() => null);
                            await loadRooms(hubInstallId);
                          }}
                        >
                          {haAreas.length > 0
                            ? haAreas.map((area) => (
                                <option key={area} value={area}>
                                  {area}
                                </option>
                              ))
                            : [room.haAreaName].map((area) => (
                                <option key={area} value={area}>
                                  {area}
                                </option>
                              ))}
                        </select>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Resync updates tenant access rules to match the new HA area name. Original name is preserved.
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
