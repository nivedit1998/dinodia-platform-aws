'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { logout as performLogout } from '@/lib/logout';

type Props = {
  username: string;
};

type StatusMessage = { type: 'success' | 'error'; message: string } | null;

const EMPTY_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

const ALEXA_SKILL_URL =
  'https://skills-store.amazon.com/deeplink/tvt/ce5823e0e48bf0fbebdd69c05e82ea253ca9f8137a8c89008963c4ba3b04e3e84f2b8674b8de634ed4ba2a52a88b9612d12b45bf82d964129002a97b49108fe88950025bd45afc1478f80162754eccb83ade4624e2ba4b88a005b1ff54f8ccbb94adfa66f95188b78f1a66c2beb6adb5';

export default function TenantSettings({ username }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [alert, setAlert] = useState<StatusMessage>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [alexaLinkVisible, setAlexaLinkVisible] = useState(false);
  const [passwordSectionOpen, setPasswordSectionOpen] = useState(false);

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
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

  return (
    <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg p-4 sm:p-6 flex flex-col gap-4">
      <header className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-snug">Tenant Settings</h1>
          <p className="text-xs text-slate-500">
            Logged in as <span className="font-medium">{username}</span>
          </p>
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
  );
}
