'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';
import { parseApiError } from '@/lib/authClientError';

type Status = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND' | null;

export default function InstallerVerifyPage() {
  const params = useSearchParams();
  const router = useRouter();
  const challengeId = params.get('challengeId');

  const [status, setStatus] = useState<Status>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [deviceLabel] = useState(() => getDeviceLabel());
  const [completing, setCompleting] = useState(false);

  const completeChallenge = useCallback(async () => {
    if (!challengeId) return;
    if (!deviceId) {
      setError('Device info missing. Please try again.');
      return;
    }
    setCompleting(true);
    const res = await fetch(`/api/auth/challenges/${challengeId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, deviceLabel }),
    });
    const data = await res.json();
    setCompleting(false);
    if (!res.ok) {
      const parsed = parseApiError(data, 'Verification failed. Please sign in again.');
      setError(parsed.message);
      return;
    }
    if (data.role === 'INSTALLER') {
      router.push('/installer/provision');
      return;
    }
    setError('This account is not an installer.');
  }, [challengeId, deviceId, deviceLabel, router]);

  useEffect(() => {
    if (!challengeId) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/auth/challenges/${challengeId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus('NOT_FOUND');
          const parsed = parseApiError(data, 'Verification request not found or expired.');
          setError(parsed.message);
          return;
        }
        if (cancelled) return;
        setStatus(data.status);

        if (data.status === 'APPROVED' && !completing) {
          await completeChallenge();
        } else if (data.status === 'EXPIRED' || data.status === 'CONSUMED') {
          setError('Verification expired. Please sign in again.');
        }
      } catch {
        // ignore transient
      }
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [challengeId, completing, completeChallenge]);

  if (!challengeId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
          <h1 className="text-2xl font-semibold text-slate-900">Check your email</h1>
          <p className="mt-2 text-sm text-slate-600">Missing verification request. Please sign in again.</p>
          <button
            onClick={() => router.push('/companylogin/login')}
            className="mt-4 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          We emailed a verification link. After clicking it, this page will continue automatically.
        </p>

        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <div>Status: {status ?? 'PENDING'}</div>
          {error && <div className="mt-1 text-rose-600">{error}</div>}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={completeChallenge}
            disabled={completing}
            className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            I clicked the link
          </button>
          <button
            onClick={() => router.push('/companylogin/login')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
}
