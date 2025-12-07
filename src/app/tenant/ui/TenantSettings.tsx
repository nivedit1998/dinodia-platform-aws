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

export default function TenantSettings({ username }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [alert, setAlert] = useState<StatusMessage>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

      <section className="text-sm border border-slate-200 rounded-xl p-4">
        <h2 className="font-semibold mb-4">Change password</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
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
            Minimum 8 characters. Contact your admin if you can&apos;t access your account.
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
      </section>

    </div>
  );
}
