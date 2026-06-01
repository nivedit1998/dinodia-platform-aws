'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RoomQrScanner } from '@/components/room/RoomQrScanner';
import { parseApiError } from '@/lib/authClientError';

type ScanResponse =
  | { ok: true; room: { id: string; displayName: string } }
  | { ok?: false; error?: string; errorCode?: string };

export default function ScanRoomPage() {
  const router = useRouter();
  const [qr, setQr] = useState<string>('');
  const [roomName, setRoomName] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const scanQr = useCallback(async (payload: string) => {
    setError(null);
    setSuccess(null);
    setRoomName(null);
    setQr(payload);
    const res = await fetch('/api/public/rooms/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr: payload }),
    });
    const data: ScanResponse = await res.json().catch(() => ({ ok: false, error: 'Invalid response' }));
    if (!res.ok || !data.ok) {
      const parsed = parseApiError(data, 'Unable to scan this room QR right now.');
      setError(parsed.message);
      return;
    }
    setRoomName(data.room.displayName);
  }, []);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!qr.trim()) {
      setError('Please scan the room QR code first.');
      return;
    }
    if (!name.trim() || !email.trim() || !phoneNumber.trim()) {
      setError('Please enter your name, email, and phone number.');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/public/rooms/request-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr, name: name.trim(), email: email.trim(), phoneNumber: phoneNumber.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      const parsed = parseApiError(data, 'Unable to request access right now. Please try again.');
      setError(parsed.message);
      return;
    }

    setSuccess('Request sent. The homeowner or property manager will review your request by email.');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8">
        <div className="mb-6 flex items-center justify-center">
          <Image
            src="/brand/logo-lockup.png"
            alt="Dinodia Smart Living"
            width={220}
            height={64}
            className="h-auto w-48 sm:w-56"
            priority
          />
        </div>

        <h1 className="text-2xl font-semibold mb-2 text-center">Scan room QR code</h1>
        <p className="text-sm text-slate-500 mb-6 text-center">Request access to a room in this home.</p>

        {error ? (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            {success}
          </div>
        ) : null}

        <div className="space-y-4">
          <RoomQrScanner onCode={scanQr} />

          {roomName ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Room</p>
              <p className="text-sm font-semibold text-slate-900">{roomName}</p>
            </div>
          ) : null}

          <form onSubmit={handleRequest} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Your name</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone number</label>
              <input
                type="tel"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+44..."
                required
              />
              <p className="mt-1 text-xs text-slate-500">Use E.164 format (include country code).</p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Requesting…' : 'Request access'}
            </button>
          </form>

          <button
            type="button"
            className="w-full text-sm font-semibold text-indigo-600 hover:underline"
            onClick={() => router.push('/login')}
            disabled={loading}
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
}
