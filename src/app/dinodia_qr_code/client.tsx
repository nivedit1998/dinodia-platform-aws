'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

type HubPayload = {
  baseUrl: string;
  longLivedToken: string;
  haUsername: string;
  haPassword: string;
};

const ACCESS_CODE = '0000';

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.replace(/\/+$/, '');
}

function buildPayload(data: HubPayload) {
  const query = new URLSearchParams({
    v: '1',
    b: data.baseUrl,
    t: data.longLivedToken,
    u: data.haUsername,
    p: data.haPassword,
  });
  return `dinodia://hub?${query.toString()}`;
}

export default function DinodiaQrCodeClient() {
  const [accessCode, setAccessCode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [form, setForm] = useState<HubPayload>({
    baseUrl: '',
    longLivedToken: '',
    haUsername: '',
    haPassword: '',
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Best-effort cache/storage clear to avoid persisting sensitive inputs.
  useEffect(() => {
    async function clearCaches() {
      try {
        if (typeof window === 'undefined') return;
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        sessionStorage?.clear();
      } catch {
        // ignore failures; intent is best-effort
      }
    }
    void clearCaches();
  }, []);

  const hubDetected = useMemo(() => {
    return (
      form.baseUrl.trim().length > 0 &&
      form.longLivedToken.trim().length > 0 &&
      form.haUsername.trim().length > 0 &&
      form.haPassword.trim().length > 0
    );
  }, [form.baseUrl, form.haPassword, form.haUsername, form.longLivedToken]);

  function updateField(key: keyof HubPayload, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setQrDataUrl(null);
    setError(null);
  }

  async function generateQr(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setQrDataUrl(null);

    const baseUrl = normalizeBaseUrl(form.baseUrl);
    if (!baseUrl || !form.longLivedToken.trim() || !form.haUsername.trim() || !form.haPassword.trim()) {
      setError('Enter base URL, long-lived access token, and HA admin credentials.');
      return;
    }
    if (!/^https?:\/\/(.*)$/i.test(baseUrl)) {
      setError('Base URL must start with http:// or https://');
      return;
    }

    setGenerating(true);
    try {
      const payload = buildPayload({
        baseUrl,
        longLivedToken: form.longLivedToken.trim(),
        haUsername: form.haUsername.trim(),
        haPassword: form.haPassword.trim(),
      });
      const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate QR code.');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-lg p-6 md:p-8">
        <h1 className="text-2xl font-semibold text-center mb-2">Generate Dinodia Hub QR</h1>
        <p className="text-sm text-slate-600 text-center mb-6">
          Installer-only page. Nothing is stored; cache is cleared on load. Do not share the generated QR.
        </p>

        {!unlocked ? (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">Access code</label>
            <input
              type="password"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setUnlocked(accessCode.trim() === ACCESS_CODE)}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
              disabled={accessCode.trim().length === 0}
            >
              Unlock
            </button>
            {accessCode && accessCode.trim() !== ACCESS_CODE ? (
              <p className="text-sm text-red-600">Incorrect code. Try again.</p>
            ) : null}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={generateQr}>
            {error ? (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">HA Admin Username</label>
                <input
                  value={form.haUsername}
                  onChange={(e) => updateField('haUsername', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">HA Admin Password</label>
                <input
                  type="password"
                  value={form.haPassword}
                  onChange={(e) => updateField('haPassword', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Base URL</label>
                <input
                  placeholder="http://192.168.0.29:8123"
                  value={form.baseUrl}
                  onChange={(e) => updateField('baseUrl', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Long-lived access token</label>
                <input
                  type="password"
                  value={form.longLivedToken}
                  onChange={(e) => updateField('longLivedToken', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  hubDetected ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              />
              <span className="text-slate-700">
                {hubDetected ? 'Dinodia Hub detected' : 'Awaiting hub details'}
              </span>
            </div>

            <button
              type="submit"
              disabled={generating}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate QR code'}
            </button>

            {qrDataUrl ? (
              <div className="mt-4 flex flex-col items-center gap-3">
                <Image
                  src={qrDataUrl}
                  alt="Dinodia Hub QR code"
                  width={192}
                  height={192}
                  className="w-48 h-48 rounded-lg border border-slate-200 shadow-sm"
                  priority
                />
                <a
                  href={qrDataUrl}
                  download="dinodia-hub-qr.png"
                  className="text-indigo-600 hover:underline text-sm font-medium"
                >
                  Download QR as image
                </a>
              </div>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
