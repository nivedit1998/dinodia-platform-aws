'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | null;

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>(null);
  const [needsEmailInput, setNeedsEmailInput] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [deviceId] = useState(() =>
    typeof window === 'undefined' ? '' : getOrCreateDeviceId()
  );
  const [deviceLabel] = useState(() =>
    typeof window === 'undefined' ? '' : getDeviceLabel()
  );

  const awaitingVerification = !!challengeId;
  const TENANT_SETUP_KEY = 'tenant_setup_state';

  const persistTenantSetupState = useCallback(
    (state: {
      username: string;
      password: string;
      deviceId: string;
      deviceLabel: string;
      challengeId?: string | null;
    }) => {
      try {
        sessionStorage.setItem(
          TENANT_SETUP_KEY,
          JSON.stringify({
            ...state,
            challengeId: state.challengeId ?? null,
          })
        );
      } catch {
        // best effort
      }
    },
    []
  );

  const resetVerification = useCallback(() => {
    setChallengeId(null);
    setChallengeStatus(null);
    setNeedsEmailInput(false);
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
      if (data.role === 'ADMIN') router.push('/admin/dashboard');
      else router.push('/tenant/dashboard');
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

    if (needsEmailInput) {
      if (!email) {
        setError('Please enter an email address.');
        return;
      }
      if (email !== confirmEmail) {
        setError('Email addresses must match.');
        return;
      }
    }

    setLoading(true);
    const payload: Record<string, unknown> = {
      username,
      password,
      deviceId,
      deviceLabel,
    };
    if (needsEmailInput) payload.email = email;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(
        data.error ||
          'We couldn’t log you in. Check your details and try again.'
      );
      return;
    }

    if (data.requiresEmailVerification) {
      const isTenant = data.role === 'TENANT';

      if (isTenant) {
        if (!deviceId || !deviceLabel) {
          setError('Device information is missing. Please try again.');
          return;
        }
        persistTenantSetupState({
          username,
          password,
          deviceId,
          deviceLabel,
          challengeId: data.challengeId ?? null,
        });
        router.push('/tenant/setup-2fa');
        return;
      }

      // Admin flow (existing inline email collection)
      if (data.needsEmailInput) {
        setNeedsEmailInput(true);
        setChallengeId(null);
        setChallengeStatus(null);
        setInfo('Add an admin email to continue.');
        return;
      }

      if (data.challengeId) {
        setChallengeId(data.challengeId);
        setNeedsEmailInput(false);
        setChallengeStatus('PENDING');
        setInfo('Check your email to approve this device.');
        return;
      }

      setError('We could not start verification. Please try again.');
      return;
    }

    const cloudEnabled = data.cloudEnabled === true;
    if (!cloudEnabled) {
      router.push('/cloud-locked');
      return;
    }
    if (data.role === 'ADMIN') router.push('/admin/dashboard');
    else router.push('/tenant/dashboard');
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
        <h1 className="text-2xl font-semibold mb-2 text-center">
          Dinodia Portal
        </h1>
        <p className="text-sm text-slate-500 mb-6 text-center">
          Login to your Dinodia account
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {needsEmailInput && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-xs text-slate-500">
                  Admins created before email verification need an email to continue.
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Admin email
                  </label>
                  <input
                    type="email"
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Confirm email
                  </label>
                  <input
                    type="email"
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Working…' : 'Login'}
            </button>
          </form>
        )}

        {awaitingVerification && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-700">
              Check your email and click the verification link. We’ll complete the login here
              once you approve this device.
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
              <p className="text-xs text-slate-500">Finishing sign-in…</p>
            )}
          </div>
        )}

        <p className="mt-4 text-xs text-slate-500 text-center">
          First time here?{' '}
          <button
            className="text-indigo-600 hover:underline"
            onClick={() => router.push('/register-admin')}
          >
            Set up this home
          </button>
        </p>
        <p className="mt-2 text-xs text-slate-500 text-center">
          Claim a home (have a code?){' '}
          <button
            className="text-indigo-600 hover:underline"
            onClick={() => router.push('/claim')}
          >
            Go to claim
          </button>
        </p>
      </div>
    </div>
  );
}
