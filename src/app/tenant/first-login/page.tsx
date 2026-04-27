'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';
import { friendlyErrorFromUnknown, parseApiError } from '@/lib/authClientError';

type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | 'NOT_FOUND' | null;

type FirstLoginState = {
  loginIntentId: string;
  deviceId: string;
  deviceLabel: string;
};

const TENANT_FIRST_LOGIN_KEY = 'tenant_first_login_state';

export default function TenantFirstLoginPage() {
  const router = useRouter();
  const [state, setState] = useState<FirstLoginState | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>(null);
  const [completing, setCompleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const awaitingVerification = !!challengeId;

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
      sessionStorage.removeItem(TENANT_FIRST_LOGIN_KEY);
    } catch {
      // ignore
    }
  }, []);

  const loadState = useCallback((): FirstLoginState | null => {
    try {
      const raw = sessionStorage.getItem(TENANT_FIRST_LOGIN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as FirstLoginState;
      if (parsed && parsed.loginIntentId && parsed.deviceId && parsed.deviceLabel) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const saveState = useCallback((val: FirstLoginState) => {
    try {
      sessionStorage.setItem(TENANT_FIRST_LOGIN_KEY, JSON.stringify(val));
    } catch {
      // ignore best effort
    }
  }, []);

  const completeChallenge = useCallback(
    async (id: string, current: FirstLoginState) => {
      setCompleting(true);
      setError(null);
      try {
        const res = await fetch(`/api/auth/challenges/${id}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: current.deviceId,
            deviceLabel: current.deviceLabel,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(parseApiError(data, 'Verification failed. Please try again.').message);
        }
        clearSavedState();
        router.push('/tenant/dashboard');
      } catch (err) {
        setError(friendlyErrorFromUnknown(err, 'Verification failed. Please try again.'));
      } finally {
        setCompleting(false);
      }
    },
    [clearSavedState, router]
  );

  const startPolling = useCallback(
    (id: string, current: FirstLoginState) => {
      stopPolling();
      const check = async () => {
        try {
          const res = await fetch(`/api/auth/challenges/${id}`, { cache: 'no-store' });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(parseApiError(data, 'Unable to check verification status.').message);
          }
          setChallengeStatus(data.status ?? null);

          if (data.status === 'APPROVED') {
            stopPolling();
            await completeChallenge(id, current);
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
          setError(friendlyErrorFromUnknown(err, 'Unable to check verification status.'));
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
      const current = state ?? loadState();
      if (!current) {
        setError('Your login session expired. Please log in again.');
        return;
      }

      if (!newPassword || !confirmNewPassword) {
        setError('Please enter a new password.');
        return;
      }
      if (newPassword !== confirmNewPassword) {
        setError('New passwords must match.');
        return;
      }
      if (!email || !confirmEmail) {
        setError('Please enter your email twice.');
        return;
      }
      if (email !== confirmEmail) {
        setError('Emails must match.');
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/auth/login-intents/${current.loginIntentId}/continue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            newPassword,
            confirmNewPassword,
            email,
            confirmEmail,
            deviceId: current.deviceId,
            deviceLabel: current.deviceLabel,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(parseApiError(data, 'We could not finish setup. Please try again.').message);
        }

        if (data.requiresEmailVerification && data.challengeId) {
          setChallengeId(data.challengeId);
          setChallengeStatus('PENDING');
          setInfo('Check your email to approve this device.');
          startPolling(data.challengeId, current);
          saveState(current);
          return;
        }

        if (data.role === 'TENANT') {
          clearSavedState();
          router.push('/tenant/dashboard');
          return;
        }

        throw new Error('Unexpected response. Please try again.');
      } catch (err) {
        setError(friendlyErrorFromUnknown(err, 'We could not finish setup. Please try again.'));
      } finally {
        setLoading(false);
      }
    },
    [
      clearSavedState,
      confirmEmail,
      confirmNewPassword,
      email,
      loadState,
      newPassword,
      router,
      saveState,
      startPolling,
      state,
    ]
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
        throw new Error(parseApiError(data, 'Unable to resend the verification email.').message);
      }
      setInfo('Verification email resent.');
    } catch (err) {
      setError(friendlyErrorFromUnknown(err, 'Unable to resend email right now.'));
    }
  }, [challengeId]);

  useEffect(() => {
    const saved = loadState();
    if (!saved) return;
    const withDevice = saved.deviceId
      ? saved
      : { ...saved, deviceId: getOrCreateDeviceId(), deviceLabel: getDeviceLabel() };
    setState(withDevice);
    saveState(withDevice);
    return () => stopPolling();
  }, [loadState, saveState, stopPolling]);

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-semibold text-slate-900">First time setup</h1>
          <p className="mt-2 text-sm text-slate-600">
            We couldn&apos;t find your login details. Please start from the login page.
          </p>
          <button
            type="button"
            className="mt-4 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
            onClick={() => router.push('/login')}
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  const pendingEmailCopy = email || confirmEmail;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-100">
        <h1 className="text-2xl font-semibold text-slate-900">First time setup</h1>
        <p className="mt-1 text-sm text-slate-600">
          Your homeowner set a temporary password. Set a new one and verify your email to continue.
        </p>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {info}
          </div>
        )}

        {!awaitingVerification ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                Step 1 · New password
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-800">New password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-800">Confirm new password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                Step 2 · Verify email
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-800">Email</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-800">Confirm email</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-60"
              >
                {loading ? 'Working…' : 'Finish setup'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  clearSavedState();
                  router.push('/login');
                }}
              >
                Back to login
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-6 space-y-4 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4">
            <p className="text-sm text-slate-700">
              We sent a verification link to{' '}
              <span className="font-medium">{pendingEmailCopy || 'your email'}</span>. Approve it to
              finish signing in.
            </p>
            {statusCopy && (
              <p className="text-xs text-slate-500">
                Status: <span className="font-medium">{statusCopy}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
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
                  onClick={() => {
                    const current = state ?? loadState();
                    if (current && challengeId) {
                      void completeChallenge(challengeId, current);
                    }
                  }}
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
                Use a different email
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  stopPolling();
                  clearSavedState();
                  router.push('/login');
                }}
              >
                Back to login
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
