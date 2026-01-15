'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { logout as performLogout } from '@/lib/logout';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type Props = {
  username: string;
};

type StatusMessage = { type: 'success' | 'error'; message: string } | null;
type TwoFaStatus = {
  email: string | null;
  emailPending: string | null;
  emailVerifiedAt: string | null;
  email2faEnabled: boolean;
};

const EMPTY_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

const EMPTY_TWO_FA_FORM = {
  email: '',
  confirmEmail: '',
};

const CHALLENGE_POLL_INTERVAL_MS = 2500;

const ALEXA_SKILL_URL =
  'https://www.amazon.com/s?k=Dinodia+Smart+Living&i=alexa-skills';

export default function TenantSettings({ username }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [alert, setAlert] = useState<StatusMessage>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [alexaLinkVisible, setAlexaLinkVisible] = useState(false);
  const [passwordSectionOpen, setPasswordSectionOpen] = useState(false);
  const [twoFaSectionOpen, setTwoFaSectionOpen] = useState(false);
  const [twoFaForm, setTwoFaForm] = useState(EMPTY_TWO_FA_FORM);
  const [twoFaAlert, setTwoFaAlert] = useState<StatusMessage>(null);
  const [twoFaStatus, setTwoFaStatus] = useState<TwoFaStatus | null>(null);
  const [twoFaStatusLoading, setTwoFaStatusLoading] = useState(false);
  const [twoFaSubmitting, setTwoFaSubmitting] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const deviceIdRef = useRef<string | null>(null);
  const deviceLabelRef = useRef<string | null>(null);
  const completingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateTwoFaField(key: keyof typeof twoFaForm, value: string) {
    setTwoFaForm((prev) => ({ ...prev, [key]: value }));
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshTwoFaStatus = useCallback(async () => {
    setTwoFaStatusLoading(true);
    try {
      const res = await fetch('/api/tenant/profile/2fa/status', {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to load verification status.');
      }
      setTwoFaStatus(data);
    } catch (err) {
      setTwoFaAlert({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Unable to load verification status.',
      });
    } finally {
      setTwoFaStatusLoading(false);
    }
  }, []);

  const completeTwoFa = useCallback(
    async (id: string) => {
      if (completingRef.current) return;
      completingRef.current = true;
      const deviceId = deviceIdRef.current ?? getOrCreateDeviceId();
      const deviceLabel = deviceLabelRef.current ?? getDeviceLabel();
      deviceIdRef.current = deviceId;
      deviceLabelRef.current = deviceLabel;

      try {
        const res = await fetch('/api/tenant/profile/2fa/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId: id, deviceId, deviceLabel }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Unable to finish verification.');
        }
        setTwoFaAlert({
          type: 'success',
          message: 'Email verification enabled. This device is trusted.',
        });
        setChallengeStatus('COMPLETED');
        setChallengeId(null);
        await refreshTwoFaStatus();
      } catch (err) {
        setTwoFaAlert({
          type: 'error',
          message: err instanceof Error ? err.message : 'Unable to finish verification.',
        });
      } finally {
        completingRef.current = false;
        stopPolling();
      }
    },
    [refreshTwoFaStatus, stopPolling]
  );

  const startChallengePolling = useCallback(
    (id: string) => {
      stopPolling();
      const runCheck = async (): Promise<boolean> => {
        try {
          const res = await fetch(`/api/auth/challenges/${id}`, { cache: 'no-store' });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Unable to check verification status.');
          }
          setChallengeStatus(data.status);

          if (data.status === 'APPROVED') {
            stopPolling();
            await completeTwoFa(id);
            return false;
          }

          if (
            data.status === 'EXPIRED' ||
            data.status === 'CONSUMED' ||
            data.status === 'NOT_FOUND'
          ) {
            stopPolling();
            setChallengeId(null);
            const statusMessage =
              data.status === 'CONSUMED'
                ? 'This verification link was already used.'
                : data.status === 'NOT_FOUND'
                  ? 'Verification request not found.'
                  : 'The verification link expired. Please try again.';
            setTwoFaAlert({
              type: 'error',
              message: statusMessage,
            });
            return false;
          }

          return true;
        } catch (err) {
          stopPolling();
          setTwoFaAlert({
            type: 'error',
            message:
              err instanceof Error ? err.message : 'Unable to check verification status.',
          });
          return false;
        }
      };

      void (async () => {
        const shouldContinue = await runCheck();
        if (shouldContinue) {
          pollRef.current = setInterval(runCheck, CHALLENGE_POLL_INTERVAL_MS);
        }
      })();
    },
    [completeTwoFa, stopPolling]
  );

  async function handleTwoFaStart(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTwoFaAlert(null);
    const deviceId = deviceIdRef.current ?? getOrCreateDeviceId();
    const deviceLabel = deviceLabelRef.current ?? getDeviceLabel();
    deviceIdRef.current = deviceId;
    deviceLabelRef.current = deviceLabel;

    if (!deviceId) {
      setTwoFaAlert({
        type: 'error',
        message: 'We need device info to continue. Please try again.',
      });
      return;
    }

    setTwoFaSubmitting(true);
    try {
      const res = await fetch('/api/tenant/profile/2fa/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: twoFaForm.email,
          confirmEmail: twoFaForm.confirmEmail,
          deviceId,
          deviceLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to start verification.');
      }
      if (data.alreadyEnabled) {
        setTwoFaAlert({ type: 'success', message: 'Two-factor authentication is already on.' });
        await refreshTwoFaStatus();
        setChallengeId(null);
        setChallengeStatus(null);
        return;
      }

      setChallengeId(data.challengeId);
      setChallengeStatus('PENDING');
      setTwoFaAlert({
        type: 'success',
        message: 'Check your email for a verification link to finish enabling 2FA.',
      });
      await refreshTwoFaStatus();
      startChallengePolling(data.challengeId);
    } catch (err) {
      setTwoFaAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to start verification.',
      });
    } finally {
      setTwoFaSubmitting(false);
    }
  }

  async function handleResendEmail() {
    if (!challengeId) return;
    setResending(true);
    try {
      const res = await fetch(`/api/auth/challenges/${challengeId}/resend`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to resend email.');
      }
      setTwoFaAlert({ type: 'success', message: 'Verification email resent.' });
    } catch (err) {
      setTwoFaAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to resend email.',
      });
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAlert(null);

    if (form.newPassword !== form.confirmNewPassword) {
      setAlert({ type: 'error', message: 'New passwords do not match' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/tenant/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to update password');
      }
      setAlert({ type: 'success', message: 'Password updated successfully' });
      setForm(EMPTY_FORM);
    } catch (err) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update password',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await performLogout();
  }

  useEffect(() => {
    deviceIdRef.current = getOrCreateDeviceId();
    deviceLabelRef.current = getDeviceLabel();
    void refreshTwoFaStatus();
    return () => {
      stopPolling();
    };
  }, [refreshTwoFaStatus, stopPolling]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    let active = true;
    async function checkAlexaDevices() {
      try {
        const res = await fetch('/api/alexa/devices', {
          cache: 'no-store',
          credentials: 'include',
        });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          throw new Error(data.error || 'Unable to load devices');
        }
        const devices = Array.isArray(data.devices) ? data.devices : [];
        setAlexaLinkVisible(devices.length > 0);
      } catch {
        if (active) {
          setAlexaLinkVisible(false);
        }
      }
    }
    void checkAlexaDevices();
    return () => {
      active = false;
    };
  }, []);

  const pendingEmail = twoFaStatus?.emailPending || twoFaForm.email;
  const challengeStatusCopy = (() => {
    switch (challengeStatus) {
      case 'PENDING':
        return 'Waiting for you to approve the email link.';
      case 'APPROVED':
        return 'Approved. Finishing setup…';
      case 'EXPIRED':
        return 'Link expired. Start again.';
      case 'CONSUMED':
        return 'This link was already used.';
      case 'NOT_FOUND':
        return 'Verification request not found.';
      case 'COMPLETED':
        return 'Email verified and device trusted.';
      default:
        return '';
    }
  })();
  const verifiedEmail = twoFaStatus?.email || pendingEmail || 'Email pending';

  return (
    <div className="min-h-screen bg-[#f5f5f7] px-3 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl bg-white rounded-2xl shadow-lg p-4 sm:p-6 flex flex-col gap-4">
        <header className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 sm:items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
              <Image
                src="/brand/logo-mark.png"
                alt="Dinodia"
                width={40}
                height={40}
                priority
              />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-snug">Tenant Settings</h1>
            <p className="text-xs text-slate-500">
              Logged in as <span className="font-medium">{username}</span>
            </p>
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm hover:bg-white"
          >
            <span className="sr-only">Menu</span>
            <span className="flex flex-col gap-1">
              <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
              <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
              <span className="block h-0.5 w-5 rounded-full bg-slate-500" />
            </span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-100 bg-white/95 p-1 text-sm text-slate-700 shadow-lg backdrop-blur">
              <Link
                href="/tenant/dashboard"
                className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Go back to Dashboard
              </Link>
              <Link
                href="/tenant/automations"
                className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Home Automations
              </Link>
              <Link
                href="/devices/manage"
                className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Manage Devices
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  setMenuOpen(false);
                  void handleLogout();
                }}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="text-sm border border-slate-200 rounded-xl">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-left font-semibold"
          onClick={() => setPasswordSectionOpen((prev) => !prev)}
        >
          <span>Change password</span>
          <span className="text-xs font-normal text-slate-500">
            {passwordSectionOpen ? 'Hide' : 'Show'}
          </span>
        </button>
        {passwordSectionOpen && (
          <div className="px-4 pb-4 pt-1 border-t border-slate-100">
            <form onSubmit={handleSubmit} className="space-y-3 mt-3">
              <div>
                <label className="block mb-1 text-xs">Current password</label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.currentPassword}
                  onChange={(e) => updateField('currentPassword', e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block mb-1 text-xs">New password</label>
                  <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.newPassword}
                    onChange={(e) => updateField('newPassword', e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <div>
                  <label className="block mb-1 text-xs">Confirm new password</label>
                  <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.confirmNewPassword}
                    onChange={(e) => updateField('confirmNewPassword', e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Minimum 8 characters. If you can&apos;t access your account, ask the homeowner who set up Dinodia to help.
              </p>
              <button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
            {alert && (
              <p
                className={`mt-2 text-xs ${
                  alert.type === 'success' ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {alert.message}
              </p>
            )}
          </div>
        )}
      </section>
      <section className="text-sm border border-slate-200 rounded-xl">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-left font-semibold"
          onClick={() => setTwoFaSectionOpen((prev) => !prev)}
        >
          <span>Two-factor authentication</span>
          <span className="text-xs font-normal text-slate-500">
            {twoFaSectionOpen ? 'Hide' : 'Show'}
          </span>
        </button>
        {twoFaSectionOpen && (
          <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
            {twoFaStatusLoading ? (
              <p className="text-xs text-slate-500">Checking your 2FA status…</p>
            ) : twoFaStatus?.email2faEnabled && twoFaStatus.emailVerifiedAt ? (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-emerald-900">
                <p className="text-xs font-semibold">2FA enabled</p>
                <p className="text-[11px] mt-1">
                  Verification email:{' '}
                  <span className="font-medium">{verifiedEmail}</span>
                </p>
                <p className="text-[11px] text-emerald-800/80 mt-1">
                  This device is trusted. New devices will need email approval.
                </p>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-600">
                  Verify your email to secure new devices. We&apos;ll trust this browser after you finish.
                </p>
                <form onSubmit={handleTwoFaStart} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="block mb-1 text-xs">Email</label>
                      <input
                        type="email"
                        className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                        value={twoFaForm.email}
                        onChange={(e) => updateTwoFaField('email', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-xs">Confirm email</label>
                      <input
                        type="email"
                        className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                        value={twoFaForm.confirmEmail}
                        onChange={(e) => updateTwoFaField('confirmEmail', e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={twoFaSubmitting}
                    className="bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {twoFaSubmitting ? 'Sending…' : 'Send verification email'}
                  </button>
                </form>
                {challengeId && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-indigo-900">
                    <p className="text-xs font-semibold">Check your email</p>
                    <p className="text-[11px] mt-1">
                      We sent a verification link to <span className="font-medium">{pendingEmail || 'your email'}</span>.
                    </p>
                    {challengeStatusCopy && (
                      <p className="text-[11px] mt-1">Status: {challengeStatusCopy}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleResendEmail()}
                        disabled={resending}
                        className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                      >
                        {resending ? 'Resending…' : 'Resend email'}
                      </button>
                      {challengeStatus === 'APPROVED' && (
                        <button
                          type="button"
                          onClick={() => void completeTwoFa(challengeId)}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          Finish setup
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            {twoFaAlert && (
              <p
                className={`text-xs ${
                  twoFaAlert.type === 'success' ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {twoFaAlert.message}
              </p>
            )}
          </div>
        )}
      </section>
      {alexaLinkVisible && (
        <section className="text-sm border border-indigo-100 rounded-xl p-4 bg-indigo-50 text-indigo-900">
          <h2 className="font-semibold mb-2">
            Connect all your Dinodia smart home devices to Alexa!
          </h2>
          <p className="text-[11px] text-indigo-900/80">
            Link your account with the Dinodia Smart Living skill to control your devices
            hands-free from the Alexa app or any Echo speaker.
          </p>
          <a
            href={ALEXA_SKILL_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Open Dinodia in Alexa
          </a>
        </section>
      )}
      </div>
    </div>
  );
}
