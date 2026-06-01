'use client';

import { useEffect, useMemo } from 'react';

const APP_STORE_URL = 'https://apps.apple.com/gb/app/dinodia-home/id6757832245';

export default function QrRoomClient({
  v,
  rid,
  token,
}: {
  v: string | null;
  rid: string | null;
  token: string | null;
}) {
  const deepLink = useMemo(() => {
    const version = (v ?? '1').trim() || '1';
    const roomId = (rid ?? '').trim();
    const t = (token ?? '').trim();
    const query = new URLSearchParams({ v: version, rid: roomId, t });
    return `dinodia://room?${query.toString()}`;
  }, [v, rid, token]);

  const isValid = Boolean((rid ?? '').trim() && (token ?? '').trim());

  useEffect(() => {
    if (!isValid) return;
    const fallbackMs = 1400;
    window.location.href = deepLink;
    const timer = window.setTimeout(() => {
      window.location.href = APP_STORE_URL;
    }, fallbackMs);
    return () => window.clearTimeout(timer);
  }, [deepLink, isValid]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-6">
        <h1 className="text-xl font-semibold text-slate-900">Opening Dinodia Home…</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isValid
            ? 'If nothing happens, use the buttons below.'
            : 'This QR link is missing required details. Ask your installer to regenerate the room QR code.'}
        </p>

        <div className="mt-5 grid gap-3">
          <a
            href={isValid ? deepLink : '#'}
            className={[
              'inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold',
              isValid ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-500 cursor-not-allowed',
            ].join(' ')}
          >
            Open Dinodia Home
          </a>
          <a
            href={APP_STORE_URL}
            className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Get the app
          </a>
        </div>
      </div>
    </div>
  );
}

