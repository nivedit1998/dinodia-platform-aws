'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | null;

const DEFAULT_HA_BASE_URL = 'http://192.168.0.29:8123';
const DEFAULT_HA_USERNAME = 'dinodiasmarthub_admin';
const DEFAULT_HA_PASSWORD = 'DinodiaSmartHub123';

export default function RegisterAdminPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    username: '',
    password: '',
    email: '',
    confirmEmail: '',
    haBaseUrl: DEFAULT_HA_BASE_URL,
    haLongLivedToken: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>(null);
  const [completing, setCompleting] = useState(false);
  const [deviceId] = useState(() =>
    typeof window === 'undefined' ? '' : getOrCreateDeviceId()
  );
  const [deviceLabel] = useState(() =>
    typeof window === 'undefined' ? '' : getDeviceLabel()
  );

  const awaitingVerification = !!challengeId;

  function updateField(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const resetVerification = useCallback(() => {
    setChallengeId(null);
    setChallengeStatus(null);
    setCompleting(false);
    setInfo(null);
  }, []);

  const completeChallenge = useCallback(
    async (id: string) => {
      if (!deviceId) {
        setError('Device information missing. Please try again.');
        resetVerification();
        return;
      }

      setCompleting(true);
      const res = await fetch(`/api/auth/challenges/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, deviceLabel }),
      });
      const data = await res.json();
      setCompleting(false);

      if (!res.ok) {
        setError(data.error || 'Verification failed. Please try again.');
        resetVerification();
        return;
      }

      const cloudEnabled = data.cloudEnabled === true;
      if (!cloudEnabled) {
        router.push('/cloud-locked');
        return;
      }
      router.push('/admin/dashboard');
    },
    [deviceId, deviceLabel, resetVerification, router]
  );

  useEffect(() => {
    if (!awaitingVerification || !challengeId) return;
    const id = challengeId;
    let cancelled = false;

    async function pollStatus() {
      try {
        const res = await fetch(`/api/auth/challenges/${id}`);
        if (!res.ok) {
          if (!cancelled) {
            setError('Verification expired. Please try again.');
            resetVerification();
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setChallengeStatus(data.status);

        if (data.status === 'APPROVED' && !completing) {
          await completeChallenge(id);
          return;
        }

        if (data.status === 'EXPIRED' || data.status === 'CONSUMED') {
          setError('Verification expired. Please try again.');
          resetVerification();
        }
      } catch {
        // ignore transient errors
      }
    }

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [awaitingVerification, challengeId, completing, completeChallenge, resetVerification]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!deviceId) {
      setError('Preparing your device info. Try again in a moment.');
      return;
    }
    if (!form.email) {
      setError('Please enter an admin email.');
      return;
    }
    if (form.email !== form.confirmEmail) {
      setError('Email addresses must match.');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/auth/register-admin', {
      method: 'POST',
      body: JSON.stringify({
        username: form.username,
        password: form.password,
        email: form.email,
        haBaseUrl: form.haBaseUrl,
        haUsername: DEFAULT_HA_USERNAME,
        haPassword: DEFAULT_HA_PASSWORD,
        haLongLivedToken: form.haLongLivedToken,
        deviceId,
        deviceLabel,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(
        data.error ||
          'We couldn’t finish setting up the homeowner account. Please check the details and try again.'
      );
      return;
    }

    if (data.challengeId) {
      setChallengeId(data.challengeId);
      setChallengeStatus('PENDING');
      setInfo('Check your email to verify and finish setup.');
      return;
    }

    setError('We could not start email verification. Please try again.');
  }

  async function handleResend() {
    if (!challengeId) return;
    setError(null);
    setInfo(null);
    const res = await fetch(`/api/auth/challenges/${challengeId}/resend`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      setError(
        data.error || 'Unable to resend the verification email right now.'
      );
      return;
    }
    setInfo('We’ve resent the verification email.');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl bg-white shadow-lg rounded-2xl p-8">
        <h1 className="text-2xl font-semibold mb-4 text-center">
          Set up the homeowner account
        </h1>
        <p className="text-xs text-slate-500 mb-4 text-center">
          This setup is for a brand-new Dinodia home. Taking over from a previous homeowner?{' '}
          <button
            type="button"
            className="text-indigo-600 hover:underline"
            onClick={() => router.push('/claim')}
          >
            Claim a home
          </button>
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {info}
          </div>
        )}

        {!awaitingVerification && (
          <form onSubmit={handleSubmit} className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium mb-1">Set Username</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Set Password</label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium mb-1">Admin email</label>
                <input
                  type="email"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Confirm email</label>
                <input
                  type="email"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.confirmEmail}
                  onChange={(e) => updateField('confirmEmail', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-xs text-slate-500 mb-2">
                Dinodia Hub connection (Home Assistant local URL).
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block font-medium mb-1">Dinodia Hub local address</label>
                  <input
                    placeholder={DEFAULT_HA_BASE_URL}
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.haBaseUrl}
                    onChange={(e) => updateField('haBaseUrl', e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">
                    Dinodia Hub long-lived access token
                  </label>
                  <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.haLongLivedToken}
                    onChange={(e) =>
                      updateField('haLongLivedToken', e.target.value)
                    }
                    required
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Connecting Dinodia Hub…' : 'Connect your Dinodia Hub'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to Login
            </button>
          </form>
        )}

        {awaitingVerification && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-700">
              Check your email and click the verification link. We’ll finish creating your admin
              session on this device after approval.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-medium text-slate-700">Status</div>
              <div>{challengeStatus ?? 'Waiting for approval…'}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleResend}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Resend email
              </button>
              <button
                onClick={resetVerification}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Start over
              </button>
            </div>
            {completing && (
              <p className="text-xs text-slate-500">Finishing setup…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
