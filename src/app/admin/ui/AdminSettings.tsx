'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { logout as performLogout } from '@/lib/logout';

type Props = {
  username: string;
};

type StatusMessage = { type: 'success' | 'error'; message: string } | null;
type TenantForm = { username: string; password: string; areas: string[] };
type TenantStringField = 'username' | 'password';

const EMPTY_TENANT_FORM: TenantForm = { username: '', password: '', areas: [] };
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
  const [tenantForm, setTenantForm] = useState<TenantForm>(EMPTY_TENANT_FORM);
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [availableAreas, setAvailableAreas] = useState<string[]>([]);
  const [newAreaInput, setNewAreaInput] = useState('');

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

  function updateTenantField(key: TenantStringField, value: string) {
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

  useEffect(() => {
    let active = true;
    async function loadAvailableAreas() {
      try {
        const res = await fetch('/api/devices');
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load devices');
        }
        if (!active) return;
        const areaSet = new Set<string>();
        const list: Array<{ area?: string | null; areaName?: string | null }> =
          Array.isArray(data.devices) ? data.devices : [];
        for (const device of list) {
          const areaName = (device.area ?? device.areaName ?? '').trim();
          if (areaName) {
            areaSet.add(areaName);
          }
        }
        setAvailableAreas(Array.from(areaSet).sort((a, b) => a.localeCompare(b)));
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('Unable to load area suggestions', err);
        }
      }
    }
    void loadAvailableAreas();
    return () => {
      active = false;
    };
  }, []);

  function addArea(areaValue?: string) {
    const valueToUse = areaValue ?? newAreaInput;
    const trimmed = valueToUse.trim();
    if (!trimmed) return;
    setTenantForm((prev) => {
      if (prev.areas.includes(trimmed)) return prev;
      return { ...prev, areas: [...prev.areas, trimmed] };
    });
    setNewAreaInput('');
  }

  function removeArea(areaValue: string) {
    setTenantForm((prev) => ({
      ...prev,
      areas: prev.areas.filter((area) => area !== areaValue),
    }));
  }

  async function handleTenantSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTenantMsg(null);

    if (tenantForm.areas.length === 0) {
      setTenantMsg('Please add at least one area for this tenant.');
      return;
    }

    setTenantLoading(true);

    try {
      const res = await fetch('/api/admin/tenant', {
        method: 'POST',
        body: JSON.stringify({
          username: tenantForm.username,
          password: tenantForm.password,
          areas: tenantForm.areas,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (!res.ok) {
        setTenantMsg(data.error || 'Failed to create tenant');
        return;
      }

      setTenantMsg('Tenant created successfully ✅');
      setTenantForm(EMPTY_TENANT_FORM);
      setNewAreaInput('');
    } catch (err) {
      console.error('Failed to create tenant', err);
      setTenantMsg('Failed to create tenant');
    } finally {
      setTenantLoading(false);
    }
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
              <label className="block mb-1 text-xs">Associated areas</label>
              <div className="flex items-center gap-2">
                <input
                  list="available-areas"
                  placeholder="Living Room, Kitchen…"
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={newAreaInput}
                  onChange={(e) => setNewAreaInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addArea();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => addArea()}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                  aria-label="Add area"
                >
                  <span className="text-lg leading-none">+</span>
                </button>
              </div>
              {availableAreas.length > 0 && (
                <datalist id="available-areas">
                  {availableAreas.map((area) => (
                    <option key={area} value={area} />
                  ))}
                </datalist>
              )}
              {tenantForm.areas.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {tenantForm.areas.map((area) => (
                    <span
                      key={area}
                      className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-700"
                    >
                      <span>{area}</span>
                      <button
                        type="button"
                        className="text-slate-500 hover:text-slate-700"
                        onClick={() => removeArea(area)}
                        aria-label={`Remove ${area}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-500">
                Add one or more rooms. Suggestions come from your Home Assistant areas.
              </p>
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
