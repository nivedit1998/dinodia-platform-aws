 'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND' | null;

type PendingLoginState = {
  username: string;
  password: string;
  deviceId: string;
  deviceLabel: string;
  challengeId?: string | null;
};

const TENANT_SETUP_KEY = 'tenant_setup_state';

export default function TenantSetup2FA() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>(null);
  const [completing, setCompleting] = useState(false);
  const [pending, setPending] = useState<PendingLoginState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const statusCopy = useMemo(() => {
    switch (challengeStatus) {
      case 'PENDING':
        return 'Waiting for you to approve the email link.';
      case 'APPROVED':
        return 'Approved. Finishing sign-in…';
      case 'EXPIRED':
        return 'Link expired. Please start again.';
      case 'CONSUMED':
        return 'This link was already used.';
      case 'NOT_FOUND':
        return 'Verification request not found.';
      default:
        return '';
    }
  }, [challengeStatus]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearSavedState = useCallback(() => {
    try {
      sessionStorage.removeItem(TENANT_SETUP_KEY);
    } catch {
      // ignore
    }
  }, []);

  const loadPending = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(TENANT_SETUP_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PendingLoginState;
      if (
        parsed &&
        parsed.username &&
        parsed.password &&
        parsed.deviceId &&
        parsed.deviceLabel
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const completeChallenge = useCallback(
    async (id: string, state: PendingLoginState) => {
      setCompleting(true);
      setError(null);
      const res = await fetch(`/api/auth/challenges/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: state.deviceId,
          deviceLabel: state.deviceLabel,
        }),
      });
      const data = await res.json();
      setCompleting(false);

      if (!res.ok) {
        setError(data.error || 'Verification failed. Please try again.');
        stopPolling();
        return;
      }

      clearSavedState();
      router.push('/tenant/dashboard');
    },
    [clearSavedState, router, stopPolling]
  );

  const startPolling = useCallback(
    (id: string, state: PendingLoginState) => {
      stopPolling();
      const check = async () => {
        try {
          const res = await fetch(`/api/auth/challenges/${id}`, { cache: 'no-store' });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Unable to check verification status.');
          }
          setChallengeStatus(data.status ?? null);

          if (data.status === 'APPROVED') {
            stopPolling();
            await completeChallenge(id, state);
            return;
          }

          if (
            data.status === 'EXPIRED' ||
            data.status === 'CONSUMED' ||
            data.status === 'NOT_FOUND'
          ) {
            stopPolling();
            setError(
              data.status === 'EXPIRED'
                ? 'The verification link expired. Please start again.'
                : data.status === 'CONSUMED'
                  ? 'This verification link was already used.'
                  : 'Verification request not found.'
            );
            setChallengeId(null);
          }
        } catch (err) {
          stopPolling();
          setError(
            err instanceof Error ? err.message : 'Unable to check verification status.'
          );
        }
      };

      void check();
      pollRef.current = setInterval(check, 2000);
    },
    [completeChallenge, stopPolling]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setInfo(null);
      const saved = pending ?? loadPending();
      if (!saved) {
        setError('Login details missing. Please start from the login page.');
        return;
      }
      if (!email || !confirmEmail) {
        setError('Please enter and confirm your email.');
        return;
      }
      if (email !== confirmEmail) {
        setError('Email addresses must match.');
        return;
      }

      setLoading(true);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: saved.username,
            password: saved.password,
            email,
            deviceId: saved.deviceId,
            deviceLabel: saved.deviceLabel,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error || 'We could not start verification. Please try again.'
          );
        }

        if (data.requiresEmailVerification && data.challengeId) {
          setChallengeId(data.challengeId);
          setChallengeStatus('PENDING');
          setInfo('Check your email to approve this device.');
          startPolling(data.challengeId, saved);
          setPending(saved);
          return;
        }

        if (data.ok) {
          clearSavedState();
          router.push('/tenant/dashboard');
          return;
        }

        throw new Error('We could not start verification. Please try again.');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'We could not start verification.'
        );
      } finally {
        setLoading(false);
      }
    },
    [clearSavedState, confirmEmail, email, loadPending, pending, router, startPolling]
  );

  const handleResend = useCallback(async () => {
    if (!challengeId) return;
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/auth/challenges/${challengeId}/resend`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to resend the verification email.');
      }
      setInfo('Verification email resent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend email.');
    }
  }, [challengeId]);

  useEffect(() => {
    const saved = loadPending();
    if (!saved) return;
    setPending(saved);
    setChallengeId(saved.challengeId ?? null);
    if (saved.challengeId) {
      setChallengeStatus('PENDING');
      startPolling(saved.challengeId, saved);
    } else {
      // fallback: ensure device ids exist
      if (!saved.deviceId) {
        const deviceId = getOrCreateDeviceId();
        const deviceLabel = getDeviceLabel();
        const updated = { ...saved, deviceId, deviceLabel };
        setPending(updated);
        try {
          sessionStorage.setItem(TENANT_SETUP_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
      }
    }
    return () => stopPolling();
  }, [loadPending, startPolling, stopPolling]);

  const pendingEmailCopy = email || confirmEmail;
  const waitingOnEmail = !!challengeId;

  if (!pending) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8 space-y-4">
          <h1 className="text-xl font-semibold text-center">Set up email verification</h1>
          <p className="text-sm text-slate-600 text-center">
            We couldn’t find your login details. Please return to the login page to start again.
          </p>
          <button
            className="w-full rounded-lg bg-indigo-600 text-white py-2.5 text-sm font-medium hover:bg-indigo-700"
            onClick={() => router.push('/login')}
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8">
        <h1 className="text-2xl font-semibold mb-2 text-center">Verify your email</h1>
        <p className="text-sm text-slate-500 mb-6 text-center">
          Add your email to secure new devices. We’ll trust this device after you finish.
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            {info}
          </div>
        )}

        {!waitingOnEmail ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Confirm email</label>
              <input
                type="email"
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send verification email'}
            </button>
            <button
              type="button"
              className="w-full text-sm text-slate-600 underline"
              onClick={() => router.push('/login')}
            >
              Back to login
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              We sent a verification link to{' '}
              <span className="font-medium">{pendingEmailCopy || 'your email'}</span>. Approve it to finish
              signing in.
            </p>
            {statusCopy && (
              <p className="text-xs text-slate-500">
                Status: <span className="font-medium">{statusCopy}</span>
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void handleResend()}
                className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
              >
                Resend email
              </button>
              {challengeStatus === 'APPROVED' && challengeId && (
                <button
                  type="button"
                  onClick={() => void completeChallenge(challengeId, pending)}
                  disabled={completing}
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {completing ? 'Finishing…' : 'Finish setup'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  stopPolling();
                  setChallengeId(null);
                  setChallengeStatus(null);
                  setInfo(null);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Enter a different email
              </button>
            </div>
            <button
              type="button"
              className="text-sm text-slate-600 underline"
              onClick={() => router.push('/login')}
            >
              Back to login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
