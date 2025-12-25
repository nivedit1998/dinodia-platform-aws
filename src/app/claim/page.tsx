'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HomeStatus } from '@prisma/client';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | null;

type ClaimContext = {
  homeStatus: HomeStatus | null;
};

export default function ClaimHomePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [claimCode, setClaimCode] = useState('');
  const [claimContext, setClaimContext] = useState<ClaimContext | null>(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    confirmEmail: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const resetVerification = useCallback(() => {
    setChallengeId(null);
    setChallengeStatus(null);
    setCompleting(false);
    setInfo(null);
  }, []);

  function resetFlow() {
    setStep(1);
    setClaimContext(null);
    setClaimCode('');
    setForm({
      username: '',
      password: '',
      confirmPassword: '',
      email: '',
      confirmEmail: '',
    });
    setError(null);
    setInfo(null);
    setCheckingCode(false);
    setSubmitting(false);
    resetVerification();
  }

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

  async function handleValidateClaimCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const trimmedCode = claimCode.trim();
    if (!trimmedCode) {
      setError('Enter the claim code to continue.');
      return;
    }

    setCheckingCode(true);
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimCode: trimmedCode, validateOnly: true }),
    });
    const data = await res.json();
    setCheckingCode(false);

    if (!res.ok) {
      setError(data.error || 'We could not validate that claim code.');
      setClaimContext(null);
      return;
    }

    setClaimContext({
      homeStatus: data.homeStatus ?? null,
    });
    setStep(2);
    setInfo('Claim code accepted. Create your admin account to continue.');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!claimContext) {
      setError('Validate the claim code first.');
      setStep(1);
      return;
    }
    if (!deviceId) {
      setError('Preparing your device info. Try again in a moment.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords must match.');
      return;
    }
    if (form.email !== form.confirmEmail) {
      setError('Email addresses must match.');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimCode: claimCode.trim(),
        username: form.username,
        password: form.password,
        email: form.email,
        deviceId,
        deviceLabel,
      }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(
        data.error ||
          'We could not start the claim. Please review the details and try again.'
      );
      if (res.status === 404 || res.status === 409) {
        setClaimContext(null);
        setStep(1);
      }
      return;
    }

    if (data.challengeId) {
      setChallengeId(data.challengeId);
      setChallengeStatus('PENDING');
      setInfo('Check your email to verify and finish claiming this home.');
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
      <div className="w-full max-w-2xl bg-white shadow-lg rounded-2xl p-8">
        <h1 className="text-2xl font-semibold mb-2 text-center">
          Claim this home
        </h1>
        <p className="text-center text-sm text-slate-600 mb-6">
          Use the claim code from the previous homeowner to create your admin account.
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

        {!awaitingVerification && step === 1 && (
          <form onSubmit={handleValidateClaimCode} className="space-y-4 text-sm">
            <div>
              <label className="block font-medium mb-1">Claim code</label>
              <input
                className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value)}
                placeholder="DND-1234-5678-ABCD"
                required
              />
            </div>
            <button
              type="submit"
              disabled={checkingCode}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {checkingCode ? 'Checking claim code…' : 'Continue'}
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

        {!awaitingVerification && step === 2 && claimContext && (
          <form onSubmit={handleSubmit} className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium mb-1">Portal username</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Portal password</label>
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
                <label className="block font-medium mb-1">Confirm password</label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.confirmPassword}
                  onChange={(e) => updateField('confirmPassword', e.target.value)}
                  required
                />
              </div>
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
            </div>

            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <label className="block font-medium mb-1">Home status</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 bg-slate-50 text-slate-700"
                  value={claimContext.homeStatus ?? 'Pending'}
                  readOnly
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Starting claim…' : 'Send verification email'}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setClaimContext(null);
                  setInfo(null);
                  setError(null);
                }}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Change claim code
              </button>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to Login
              </button>
            </div>
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
                onClick={resetFlow}
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
