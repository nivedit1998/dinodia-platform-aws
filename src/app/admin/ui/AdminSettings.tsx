'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { logout as performLogout } from '@/lib/logout';

type Props = {
  username: string;
};

type StatusMessage = { type: 'success' | 'error'; message: string } | null;

const EMPTY_TENANT_FORM = { username: '', password: '', area: '' };
const EMPTY_PASSWORD_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};
const EMPTY_HA_FORM = {
  haUsername: '',
  haBaseUrl: '',
  haCloudUrl: '',
  haPassword: '',
  haLongLivedToken: '',
};

export default function AdminSettings({ username }: Props) {
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT_FORM);
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);

  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [passwordAlert, setPasswordAlert] = useState<StatusMessage>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [haForm, setHaForm] = useState(EMPTY_HA_FORM);
  const [haAlert, setHaAlert] = useState<StatusMessage>(null);
  const [haStatus, setHaStatus] = useState({
    hasPassword: false,
    hasLongLivedToken: false,
  });
  const [haLoading, setHaLoading] = useState(false);
  const [haBootstrapError, setHaBootstrapError] = useState<string | null>(null);
  const [haInitialLoading, setHaInitialLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function updateTenantField(key: keyof typeof tenantForm, value: string) {
    setTenantForm((prev) => ({ ...prev, [key]: value }));
  }

  function updatePasswordField(key: keyof typeof passwordForm, value: string) {
    setPasswordForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateHaField(key: keyof typeof haForm, value: string) {
    setHaForm((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    let mounted = true;
    async function getHaSettings() {
      try {
        const res = await fetch('/api/admin/profile/ha-settings');
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Unable to load HA settings');
        }
        if (!mounted) return;
        setHaForm((prev) => ({
          ...prev,
          haUsername: data.haUsername ?? '',
          haBaseUrl: data.haBaseUrl ?? '',
          haCloudUrl: data.haCloudUrl ?? '',
          haPassword: '',
          haLongLivedToken: '',
        }));
        setHaStatus({
          hasPassword: Boolean(data.hasHaPassword),
          hasLongLivedToken: Boolean(data.hasLongLivedToken),
        });
        setHaBootstrapError(null);
      } catch (err) {
        if (!mounted) return;
        setHaBootstrapError(
          err instanceof Error ? err.message : 'Unable to load HA settings'
        );
      } finally {
        if (mounted) {
          setHaInitialLoading(false);
        }
      }
    }
    getHaSettings();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleTenantSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTenantMsg(null);
    setTenantLoading(true);

    const res = await fetch('/api/admin/tenant', {
      method: 'POST',
      body: JSON.stringify(tenantForm),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    setTenantLoading(false);

    if (!res.ok) {
      setTenantMsg(data.error || 'Failed to create tenant');
      return;
    }

    setTenantMsg('Tenant created successfully ✅');
    setTenantForm(EMPTY_TENANT_FORM);
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordAlert(null);

    if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
      setPasswordAlert({ type: 'error', message: 'New passwords do not match' });
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch('/api/admin/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to update password');
      }
      setPasswordAlert({ type: 'success', message: 'Password updated successfully' });
      setPasswordForm(EMPTY_PASSWORD_FORM);
    } catch (err) {
      setPasswordAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update password',
      });
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleHaSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHaAlert(null);

    const payload: Record<string, string> = {
      haUsername: haForm.haUsername.trim(),
      haBaseUrl: haForm.haBaseUrl.trim(),
    };
    const cloudUrl = haForm.haCloudUrl.trim();
    if (cloudUrl) {
      payload.haCloudUrl = cloudUrl;
    }
    if (haForm.haPassword) {
      payload.haPassword = haForm.haPassword;
    }
    if (haForm.haLongLivedToken) {
      payload.haLongLivedToken = haForm.haLongLivedToken;
    }

    setHaLoading(true);
    try {
      const res = await fetch('/api/admin/profile/ha-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to update HA settings');
      }
      setHaAlert({ type: 'success', message: 'Home Assistant settings updated' });
      setHaForm((prev) => ({
        ...prev,
        haUsername: data.haUsername ?? prev.haUsername,
        haBaseUrl: data.haBaseUrl ?? prev.haBaseUrl,
        haCloudUrl: data.haCloudUrl ?? '',
        haPassword: '',
        haLongLivedToken: '',
      }));
      setHaStatus({
        hasPassword: Boolean(data.hasHaPassword),
        hasLongLivedToken: Boolean(data.hasLongLivedToken),
      });
    } catch (err) {
      setHaAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update HA settings',
      });
    } finally {
      setHaLoading(false);
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
    <div className="w-full max-w-4xl bg-white rounded-2xl shadow-lg p-4 sm:p-6 flex flex-col gap-5 sm:gap-6">
      <header className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-snug">Dinodia Admin Settings</h1>
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
                href="/admin/dashboard"
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

      <section className="grid gap-5 text-sm lg:grid-cols-2">
        <div className="border border-slate-200 rounded-xl p-4 lg:col-span-2">
          <h2 className="font-semibold mb-4">Profile</h2>
          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Change password
              </h3>
              <form onSubmit={handlePasswordSubmit} className="mt-3 space-y-3">
                <div>
                  <label className="block mb-1 text-xs">Current password</label>
                  <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={passwordForm.currentPassword}
                    onChange={(e) => updatePasswordField('currentPassword', e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block mb-1 text-xs">New password</label>
                    <input
                      type="password"
                      className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                      value={passwordForm.newPassword}
                      onChange={(e) => updatePasswordField('newPassword', e.target.value)}
                      required
                      minLength={8}
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-xs">Confirm new password</label>
                    <input
                      type="password"
                      className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                      value={passwordForm.confirmNewPassword}
                      onChange={(e) =>
                        updatePasswordField('confirmNewPassword', e.target.value)
                      }
                      required
                      minLength={8}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Minimum 8 characters. Use a unique passphrase for security.
                </p>
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {passwordLoading ? 'Updating…' : 'Update password'}
                </button>
              </form>
              {passwordAlert && (
                <p
                  className={`mt-2 text-xs ${
                    passwordAlert.type === 'success' ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {passwordAlert.message}
                </p>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Home Assistant integration
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                We only show username and base URL for security. Enter a new Home Assistant
                password or long-lived token to replace what&apos;s stored.
              </p>
              {haBootstrapError && (
                <p className="mt-2 text-xs text-red-600">{haBootstrapError}</p>
              )}
              <form onSubmit={handleHaSubmit} className="mt-3 space-y-3">
                <div>
                  <label className="block mb-1 text-xs">HA username</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={haForm.haUsername}
                    onChange={(e) => updateHaField('haUsername', e.target.value)}
                    required
                    disabled={haInitialLoading}
                  />
                </div>
                <div>
                  <label className="block mb-1 text-xs">HA base URL</label>
                  <input
                    placeholder="https://example.ui.nabu.casa"
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={haForm.haBaseUrl}
                    onChange={(e) => updateHaField('haBaseUrl', e.target.value)}
                    required
                    disabled={haInitialLoading}
                  />
                </div>
                <div>
                  <label className="block mb-1 text-xs">HA Cloud URL (optional)</label>
                  <input
                    placeholder="https://example.ui.nabu.casa/"
                    className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                    value={haForm.haCloudUrl}
                    onChange={(e) => updateHaField('haCloudUrl', e.target.value)}
                    disabled={haInitialLoading}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Leave blank if this home does not use a cloud URL.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block mb-1 text-xs">HA password</label>
                    <input
                      type="password"
                      className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                      value={haForm.haPassword}
                      onChange={(e) => updateHaField('haPassword', e.target.value)}
                      placeholder={haStatus.hasPassword ? 'Stored – enter to replace' : ''}
                      disabled={haInitialLoading}
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Leave blank to keep existing password.</p>
                  </div>
                  <div>
                    <label className="block mb-1 text-xs">HA long-lived token</label>
                    <input
                      type="password"
                      className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                      value={haForm.haLongLivedToken}
                      onChange={(e) => updateHaField('haLongLivedToken', e.target.value)}
                      placeholder={haStatus.hasLongLivedToken ? 'Stored – enter to replace' : ''}
                      disabled={haInitialLoading}
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Leave blank to keep the current token.
                    </p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={haLoading || haInitialLoading}
                  className="bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  {haLoading ? 'Saving…' : 'Update Home Assistant settings'}
                </button>
              </form>
              {haAlert && (
                <p
                  className={`mt-2 text-xs ${
                    haAlert.type === 'success' ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {haAlert.message}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl p-4">
          <h2 className="font-semibold mb-4">Home setup – add tenant</h2>
          <form onSubmit={handleTenantSubmit} className="space-y-3">
            <div>
              <label className="block mb-1 text-xs">Tenant username</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={tenantForm.username}
                onChange={(e) => updateTenantField('username', e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block mb-1 text-xs">Tenant password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={tenantForm.password}
                onChange={(e) => updateTenantField('password', e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block mb-1 text-xs">Associated area</label>
              <input
                placeholder="Room 1, Kitchen..."
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={tenantForm.area}
                onChange={(e) => updateTenantField('area', e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={tenantLoading}
              className="mt-1 bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {tenantLoading ? 'Adding…' : 'Add tenant'}
            </button>
          </form>
          {tenantMsg && (
            <p className="mt-2 text-xs text-slate-600">{tenantMsg}</p>
          )}
        </div>

      </section>
    </div>
  );
}
