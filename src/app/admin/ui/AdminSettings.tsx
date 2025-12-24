'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { logout as performLogout } from '@/lib/logout';

type Props = {
  username: string;
};

type StatusMessage = { type: 'success' | 'error'; message: string } | null;
type TenantForm = { username: string; password: string; areas: string[] };
type TenantStringField = 'username' | 'password';
type SellingMode = 'FULL_RESET' | 'OWNER_TRANSFER';

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

const ALEXA_SKILL_URL =
  'https://skills-store.amazon.com/deeplink/tvt/ce5823e0e48bf0fbebdd69c05e82ea253ca9f8137a8c89008963c4ba3b04e3e84f2b8674b8de634ed4ba2a52a88b9612d12b45bf82d964129002a97b49108fe88950025bd45afc1478f80162754eccb83ade4624e2ba4b88a005b1ff54f8ccbb94adfa66f95188b78f1a66c2beb6adb5';

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
  const [haLoading, setHaLoading] = useState(false);
  const [haBootstrapError, setHaBootstrapError] = useState<string | null>(null);
  const [haInitialLoading, setHaInitialLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<{
    status: 'checking' | 'enabled' | 'disabled' | 'error';
    message: string | null;
  }>({ status: 'checking', message: null });
  const [showRemoteGuide, setShowRemoteGuide] = useState(false);
  const [atHomeConfirmed, setAtHomeConfirmed] = useState(false);
  const [nabuCasaConfirmed, setNabuCasaConfirmed] = useState(false);
  const [haCloudConfirmed, setHaCloudConfirmed] = useState(false);
  const [alexaDevicesAvailable, setAlexaDevicesAvailable] = useState(false);
  const [haCredentials, setHaCredentials] = useState({
    username: '',
    password: '',
  });
  const [passwordSectionOpen, setPasswordSectionOpen] = useState(false);
  const [sellingModalOpen, setSellingModalOpen] = useState(false);
  const [sellingMode, setSellingMode] = useState<SellingMode | null>(null);
  const [sellingLoading, setSellingLoading] = useState(false);
  const [sellingError, setSellingError] = useState<string | null>(null);
  const [sellingClaimCode, setSellingClaimCode] = useState<string | null>(null);
  const [claimCopyStatus, setClaimCopyStatus] = useState<string | null>(null);

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
          throw new Error(
            data.error ||
              'We couldn’t load your Dinodia Hub settings. Please check the connection details or try again.'
          );
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
        setHaCredentials({
          username: data.haUsername ?? '',
          password: data.haAdminPassword ?? '',
        });
        setHaBootstrapError(null);
      } catch (err) {
        if (!mounted) return;
        setHaBootstrapError(
          err instanceof Error
            ? err.message
            : 'We couldn’t load your Dinodia Hub settings. Please try again.'
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

  const loadAvailableAreas = useCallback(async (fresh = false) => {
    try {
      const res = await fetch(fresh ? '/api/devices?fresh=1' : '/api/devices');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load devices');
      }
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
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      await loadAvailableAreas(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [loadAvailableAreas]);

  useEffect(() => {
    if (remoteStatus.status !== 'enabled') return;
    let active = true;
    const refreshAreas = async () => {
      await loadAvailableAreas(true);
    };
    void refreshAreas();
    return () => {
      active = false;
    };
  }, [remoteStatus.status, loadAvailableAreas]);

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

  const refreshRemoteStatus = useCallback(async () => {
    setRemoteStatus({ status: 'checking', message: null });
    try {
      const res = await fetch('/api/alexa/devices', {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to check remote access');
      }
      const devices = Array.isArray(data.devices) ? data.devices : [];
      const hasDevices = devices.length > 0;
      setRemoteStatus({
        status: hasDevices ? 'enabled' : 'disabled',
        message: hasDevices
          ? null
          : 'Remote access isn’t turned on yet. Complete the steps below so Dinodia can reach your home when you’re away.',
      });
      setAlexaDevicesAvailable(hasDevices);
      if (hasDevices) {
        setShowRemoteGuide(false);
        setAtHomeConfirmed(false);
        setNabuCasaConfirmed(false);
        setHaCloudConfirmed(false);
      }
    } catch (err) {
      setRemoteStatus({
        status: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'We couldn’t check remote access. Make sure your Dinodia Hub is online and signed into Nabu Casa, then try again.',
      });
      setAlexaDevicesAvailable(false);
    }
  }, []);

  useEffect(() => {
    void refreshRemoteStatus();
  }, [refreshRemoteStatus]);

  async function handleTenantSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTenantMsg(null);

    if (tenantLocked) {
      setTenantMsg('Remote access must be enabled to add tenants from this portal.');
      return;
    }

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
        setTenantMsg(
          data.error || 'We couldn’t create this tenant right now. Please try again.'
        );
        return;
      }

      setTenantMsg('Tenant created successfully ✅');
      setTenantForm(EMPTY_TENANT_FORM);
      setNewAreaInput('');
    } catch (err) {
      console.error('Failed to create tenant', err);
      setTenantMsg('We couldn’t create this tenant right now. Please try again.');
    } finally {
      setTenantLoading(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordAlert(null);

    if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
      setPasswordAlert({ type: 'error', message: 'New passwords do not match.' });
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
        throw new Error(
          data.error || 'We couldn’t update your password right now. Please try again.'
        );
      }
      setPasswordAlert({ type: 'success', message: 'Password updated successfully.' });
      setPasswordForm(EMPTY_PASSWORD_FORM);
    } catch (err) {
      setPasswordAlert({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'We couldn’t update your password right now. Please try again.',
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
        throw new Error(
          data.error ||
            'We couldn’t save these Dinodia Hub settings. Please check the details and try again.'
        );
      }
      setHaAlert({
        type: 'success',
        message: 'Remote access link saved. We are checking the connection now.',
      });
      setHaForm((prev) => ({
        ...prev,
        haUsername: data.haUsername ?? prev.haUsername,
        haBaseUrl: data.haBaseUrl ?? prev.haBaseUrl,
        haCloudUrl: data.haCloudUrl ?? '',
        haPassword: '',
        haLongLivedToken: '',
      }));
      setHaCredentials((prev) => ({
        username: data.haUsername ?? prev.username,
        password:
          typeof data.haAdminPassword === 'string' && data.haAdminPassword.length > 0
            ? data.haAdminPassword
            : prev.password,
      }));
      void refreshRemoteStatus();
    } catch (err) {
      setHaAlert({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'We couldn’t save your remote access link. Please try again.',
      });
    } finally {
      setHaLoading(false);
    }
  }

  async function handleLogout() {
    await performLogout();
  }

  function openSellingModal() {
    setSellingModalOpen(true);
    setSellingError(null);
    setClaimCopyStatus(null);
    if (!sellingClaimCode) {
      setSellingMode(null);
    }
  }

  function closeSellingModal() {
    setSellingModalOpen(false);
    setSellingError(null);
    setClaimCopyStatus(null);
    if (!sellingClaimCode) {
      setSellingMode(null);
    }
  }

  function selectSellingMode(mode: SellingMode) {
    setSellingMode(mode);
    setSellingError(null);
  }

  async function confirmSellingSelection(mode: SellingMode) {
    if (sellingClaimCode) return;
    setSellingLoading(true);
    setSellingError(null);
    try {
      const res = await fetch('/api/admin/selling-property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || 'We couldn’t process this request. Please try again.'
        );
      }
      if (!data.claimCode || typeof data.claimCode !== 'string') {
        throw new Error('We could not retrieve the claim code. Please try again.');
      }
      setSellingClaimCode(data.claimCode);
      setSellingMode(mode);
    } catch (err) {
      setSellingError(
        err instanceof Error
          ? err.message
          : 'We couldn’t process this request. Please try again.'
      );
    } finally {
      setSellingLoading(false);
    }
  }

  async function copyClaimCode() {
    if (!sellingClaimCode) return;
    try {
      await navigator.clipboard.writeText(sellingClaimCode);
      setClaimCopyStatus('Copied');
    } catch (err) {
      setClaimCopyStatus('Copy failed');
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Clipboard copy failed', err);
      }
    } finally {
      setTimeout(() => setClaimCopyStatus(null), 2000);
    }
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

  const remoteStatusToneClass =
    remoteStatus.status === 'enabled'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : remoteStatus.status === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : remoteStatus.status === 'checking'
      ? 'border-slate-200 bg-slate-50 text-slate-600'
      : 'border-amber-200 bg-amber-50 text-amber-700';

  const remoteStatusCopy =
    remoteStatus.status === 'enabled'
      ? 'Remote access is enabled via Nabu Casa — Dinodia can reach your home when you’re away.'
      : remoteStatus.status === 'checking'
      ? 'Checking remote access status…'
      : remoteStatus.message ||
        'Remote access isn’t turned on yet. Complete the steps below so Dinodia can reach your home when you’re away.';
  const showHaAdminCredentials =
    (haCredentials.username && haCredentials.username.trim().length > 0) ||
    (haCredentials.password && haCredentials.password.trim().length > 0);
  const remoteAccessEnabled = remoteStatus.status === 'enabled';
  const tenantLocked = !remoteAccessEnabled;

  return (
    <div className="w-full max-w-4xl bg-white rounded-2xl shadow-lg p-4 sm:p-6 flex flex-col gap-5 sm:gap-6">
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
            <h1 className="text-2xl font-semibold leading-snug">Homeowner Settings</h1>
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
            <div className="rounded-xl border border-slate-200/60">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500"
                onClick={() => setPasswordSectionOpen((prev) => !prev)}
              >
                <span>Change password</span>
                <span className="text-[11px] font-normal text-slate-400">
                  {passwordSectionOpen ? 'Hide' : 'Show'}
                </span>
              </button>
              {passwordSectionOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100">
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
                        passwordAlert.type === 'success'
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      }`}
                    >
                      {passwordAlert.message}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">
                Remote access
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                Enabling remote access gives Alexa support to all your tenants and enables
                cloud mode so you can control your devices from anywhere in the world.
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Follow the steps below to add Remote access via Nabu Casa which costs $7
                per month.
              </p>
              {haBootstrapError && (
                <p className="mt-2 text-xs text-red-600">{haBootstrapError}</p>
              )}
              <div
                className={`mt-3 rounded-lg border px-4 py-3 text-xs ${remoteStatusToneClass}`}
              >
                <p className="font-medium">{remoteStatusCopy}</p>
                {remoteStatus.status !== 'checking' && (
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center gap-1 rounded-full border border-current px-3 py-1 text-[11px] font-medium hover:bg-white/20"
                    onClick={() => void refreshRemoteStatus()}
                  >
                    Re-check status
                  </button>
                )}
              </div>
              {remoteStatus.status !== 'enabled' && (
                <button
                  type="button"
                  className="mt-3 inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setShowRemoteGuide((prev) => !prev)}
                >
                  {showRemoteGuide
                    ? 'Hide setup instructions'
                    : 'Get remote access for this home'}
                </button>
              )}
              {showRemoteGuide && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold">
                      Step 1 – Confirm you&apos;re at the property
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      You must be on the home Wi-Fi so the Dinodia tablet can reach your
                      Dinodia Hub (Home Assistant) locally while you finish the setup.
                    </p>
                    <button
                      type="button"
                      className="mt-3 inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => setAtHomeConfirmed(true)}
                      disabled={atHomeConfirmed}
                    >
                      {atHomeConfirmed ? 'Confirmed' : 'I’m at home and on Wi-Fi'}
                    </button>
                    {atHomeConfirmed && (
                      <p className="mt-2 text-[11px] text-emerald-600">
                        Great! Keep going with the steps below.
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold">
                      Step 2 – Create / log into Nabu Casa
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      You need a Nabu Casa account and subscription to unlock secure remote
                      access for Dinodia Cloud.
                    </p>
                    <a
                      href="https://account.nabucasa.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                      Open Nabu Casa
                    </a>
                    <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        checked={nabuCasaConfirmed}
                        onChange={(e) => setNabuCasaConfirmed(e.target.checked)}
                      />
                      I&apos;ve created an account and subscribed.
                    </label>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold">
                      Step 3 – Connect your Dinodia Hub (Home Assistant) to Nabu Casa
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Open your Dinodia Hub (Home Assistant) with the homeowner login. Open
                      the Cloud page and sign in with the same Nabu Casa email &amp; password.
                    </p>
                    {showHaAdminCredentials && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                        <p className="text-sm font-semibold">
                          Dinodia Hub (Home Assistant) homeowner login — keep this secret
                        </p>
                        <dl className="mt-3 space-y-2 text-xs text-amber-900/90">
                          <div>
                            <dt className="font-semibold uppercase text-[10px] tracking-wide">
                              Username
                            </dt>
                            <dd className="font-mono text-sm">
                              {haCredentials.username || 'Not set'}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase text-[10px] tracking-wide">
                              Password
                            </dt>
                            <dd className="font-mono text-sm">
                              {haCredentials.password || 'Not set'}
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-3 text-[11px]">
                          Use these only at <strong>http://homeassistant.local:8123</strong>{' '}
                          during this setup. Do not share them with anyone.
                        </p>
                      </div>
                    )}
                    <a
                      href="http://homeassistant.local:8123/config/cloud/account"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open Dinodia Hub (Home Assistant) Cloud settings
                    </a>
                    <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        checked={haCloudConfirmed}
                        onChange={(e) => setHaCloudConfirmed(e.target.checked)}
                      />
                      I&apos;ve logged into my Dinodia Hub (Home Assistant) and Nabu Casa Cloud.
                    </label>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold">
                      Step 4 – Save your remote access link
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Your Dinodia Hub (Home Assistant) now shows a <strong>Remote access</strong> link at the
                      top of that Cloud page. Copy it exactly and paste it below.
                    </p>
                    <form onSubmit={handleHaSubmit} className="mt-3 space-y-3">
                      <div>
                        <label className="block mb-1 text-xs">Remote access link</label>
                        <input
                          type="url"
                          placeholder="https://example.ui.nabu.casa"
                          className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                          value={haForm.haCloudUrl}
                          onChange={(e) => updateHaField('haCloudUrl', e.target.value)}
                          required
                          disabled={haInitialLoading}
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          This should match the URL under Remote access on the Dinodia Hub
                          (Home Assistant) Cloud page.
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={haLoading || haInitialLoading}
                        className="bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {haLoading ? 'Saving…' : 'Submit remote access link'}
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
              )}
              {alexaDevicesAvailable && (
                <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-900">
                  <p className="text-sm font-semibold">
                    Connect all your Dinodia smart home devices to Alexa!
                  </p>
                  <p className="mt-1 text-[11px] text-indigo-900/80">
                    Tap below to open the Dinodia Smart Living skill inside your Alexa app
                    and finish linking for voice control.
                  </p>
                  <a
                    href={ALEXA_SKILL_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                  >
                    Open Dinodia in Alexa
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl p-4">
          <h2 className="font-semibold mb-4">Home setup – add tenant</h2>
          {tenantLocked && (
            <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Remote access must be enabled before adding tenants from this portal.
              To add tenants without paying for remote access you will have to use your
              iOS/Android phone or the Dinodia Kiosk.
            </p>
          )}
          <form onSubmit={handleTenantSubmit} className="space-y-3">
            <div>
              <label className="block mb-1 text-xs">Tenant username</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={tenantForm.username}
                onChange={(e) => updateTenantField('username', e.target.value)}
                required
                disabled={tenantLocked}
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
                disabled={tenantLocked}
              />
            </div>
            <div>
              <label className="block mb-1 text-xs">Associated areas</label>
              <div className="flex items-center gap-2">
                <select
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={newAreaInput}
                  onChange={(e) => setNewAreaInput(e.target.value)}
                  disabled={tenantLocked || availableAreas.length === 0}
                >
                  <option value="">
                    {availableAreas.length > 0 ? 'Select an area' : 'No areas available'}
                  </option>
                  {availableAreas.map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => addArea()}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                  aria-label="Add area"
                  disabled={tenantLocked || !newAreaInput}
                >
                  <span className="text-lg leading-none">+</span>
                </button>
              </div>
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
                Add one or more rooms. Suggestions come from your Dinodia Hub (Home Assistant) areas.
              </p>
            </div>
            <button
              type="submit"
              disabled={tenantLoading || tenantLocked}
              className="mt-1 bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {tenantLoading ? 'Adding…' : 'Add tenant'}
            </button>
          </form>
          {tenantMsg && (
            <p className="mt-2 text-xs text-slate-600">{tenantMsg}</p>
          )}
        </div>

        <div className="border border-slate-200 rounded-xl p-4 lg:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Selling Property</h2>
              <p className="text-[11px] text-slate-500 mt-1">
                Issue a one-time claim code for the next homeowner.
              </p>
            </div>
            <button
              type="button"
              onClick={openSellingModal}
              disabled={sellingLoading}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {sellingClaimCode ? 'View claim code' : 'Selling Property'}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Choose if everyone is leaving or if tenants stay. We’ll guide you through issuing the
            claim code and sign you out once you confirm.
          </p>
          {sellingClaimCode && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              A claim code has already been generated for this home. Share it with the incoming
              homeowner before you finish.
            </p>
          )}
        </div>

      </section>

      {sellingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Selling Property</h3>
                <p className="text-xs text-slate-500">
                  Generate the claim code for the next homeowner.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSellingModal}
                disabled={sellingLoading}
                className="text-slate-500 hover:text-slate-700"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {sellingClaimCode ? (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-slate-700">
                  Share this code with the new homeowner. It only shows once and you&apos;ll be
                  signed out after you confirm.
                </p>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                  <span className="font-mono text-lg font-semibold tracking-widest text-indigo-900">
                    {sellingClaimCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyClaimCode()}
                    className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm hover:bg-indigo-50"
                  >
                    Copy
                  </button>
                </div>
                {claimCopyStatus && (
                  <p className="text-xs text-indigo-700">{claimCopyStatus}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    onClick={() => void handleLogout()}
                  >
                    I saved the code
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={closeSellingModal}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={() => selectSellingMode('FULL_RESET')}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      sellingMode === 'FULL_RESET'
                        ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                    disabled={sellingLoading}
                  >
                    <p className="text-sm font-semibold">Are you and all tenants leaving?</p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Fully reset this home so the next owner starts fresh.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSellingMode('OWNER_TRANSFER')}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      sellingMode === 'OWNER_TRANSFER'
                        ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                    disabled={sellingLoading}
                  >
                    <p className="text-sm font-semibold">Are you leaving and tenants remaining?</p>
                    <p className="mt-1 text-[11px] text-slate-600">
                      Remove your ownership while keeping tenant devices and automations.
                    </p>
                  </button>
                </div>

                {sellingMode && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    <p className="text-sm font-semibold">Please confirm</p>
                    <p className="mt-2 text-sm">
                      {sellingMode === 'FULL_RESET'
                        ? 'This will remove all tenant devices, automations, alexa links and accounts and fully reset your Dinodia home for the new homeowner and tenants'
                        : 'This will remove your property but keep all tenants added devices, automations, alexa links and accounts'}
                    </p>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide">Is this ok?</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                        disabled={sellingLoading}
                        onClick={() => void confirmSellingSelection(sellingMode)}
                      >
                        {sellingLoading ? 'Working…' : 'Yes'}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        disabled={sellingLoading}
                        onClick={() => setSellingMode(null)}
                      >
                        Cancel
                      </button>
                    </div>
                    {sellingError && (
                      <p className="mt-2 text-xs text-red-700">{sellingError}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
