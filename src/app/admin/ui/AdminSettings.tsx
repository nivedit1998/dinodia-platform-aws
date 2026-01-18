'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { logout as performLogout } from '@/lib/logout';
import { platformFetch } from '@/lib/platformFetchClient';

type Props = {
  username: string;
};

type StatusMessage = { type: 'success' | 'error'; message: string } | null;
type TenantForm = { username: string; password: string; areas: string[] };
type TenantStringField = 'username' | 'password';
type SellingMode = 'FULL_RESET' | 'OWNER_TRANSFER';
type TenantInfo = { id: number; username: string; areas: string[] };
type TenantActionState = { saving: boolean; error: string | null };

const EMPTY_TENANT_FORM: TenantForm = { username: '', password: '', areas: [] };
const EMPTY_PASSWORD_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};
const IOS_APP_URL = 'https://apps.apple.com';
const ANDROID_APP_URL = 'https://play.google.com/store';
const KIOSK_URL = 'https://dinodiasmartliving.com/kiosk';
const TENANT_LOCKED_MESSAGE =
  'Remote access must be enabled before adding tenants from this portal. To add tenants without paying for remote access you will have to use your iOS/Android phone or the Dinodia Kiosk.';

export default function AdminSettings({ username }: Props) {
  const [tenantForm, setTenantForm] = useState<TenantForm>(EMPTY_TENANT_FORM);
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [availableAreas, setAvailableAreas] = useState<string[]>([]);
  const [newAreaInput, setNewAreaInput] = useState('');
  const [viewTenantsOpen, setViewTenantsOpen] = useState(false);
  const [addTenantOpen, setAddTenantOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [tenantActions, setTenantActions] = useState<Record<number, TenantActionState>>({});
  const [tenantAreaInputs, setTenantAreaInputs] = useState<Record<number, string>>({});
  const [tenantToDelete, setTenantToDelete] = useState<TenantInfo | null>(null);
  const [tenantDeleteLoading, setTenantDeleteLoading] = useState(false);
  const [tenantDeleteError, setTenantDeleteError] = useState<string | null>(null);

  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);
  const [passwordAlert, setPasswordAlert] = useState<StatusMessage>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<{
    status: 'checking' | 'enabled' | 'disabled' | 'error';
    message: string | null;
  }>({ status: 'enabled', message: null });
  const [alexaDevicesAvailable, setAlexaDevicesAvailable] = useState(false);
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

  const loadAvailableAreas = useCallback(async (fresh = false) => {
    try {
      const res = await platformFetch(fresh ? '/api/devices?fresh=1' : '/api/devices');
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
    void loadAvailableAreas(false);
  }, [loadAvailableAreas]);

  useEffect(() => {
    if (remoteStatus.status !== 'enabled') return;
    void loadAvailableAreas(true);
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
    setRemoteStatus({ status: 'enabled', message: null });
    setAlexaDevicesAvailable(true);
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
      const res = await platformFetch('/api/admin/tenant', {
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
      if (viewTenantsOpen && !tenantLocked) {
        void fetchTenants();
      }
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
      const res = await platformFetch('/api/admin/profile/change-password', {
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
      const res = await platformFetch('/api/admin/selling-property', {
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
      if (mode === 'OWNER_TRANSFER') {
        if (!data.claimCode || typeof data.claimCode !== 'string') {
          throw new Error('We could not retrieve the claim code. Please try again.');
        }
        setSellingClaimCode(data.claimCode);
        setSellingMode(mode);
      } else {
        // FULL_RESET: no claim code, sign out after success.
        setSellingMode(null);
        setSellingClaimCode(null);
        await performLogout();
      }
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
      ? 'Cloud access is configured for this home.'
      : 'Cloud access status unknown.';
  const remoteAccessEnabled = remoteStatus.status === 'enabled';
  const tenantLocked = !remoteAccessEnabled;
  const deregisterLocked = !remoteAccessEnabled;
  const showRemoteActions = false;

  function updateTenantActionState(tenantId: number, updates: Partial<TenantActionState>) {
    setTenantActions((prev) => ({
      ...prev,
      [tenantId]: { ...(prev[tenantId] ?? { saving: false, error: null }), ...updates },
    }));
  }

  const fetchTenants = useCallback(async () => {
    if (tenantLocked) return;
    setTenantsLoading(true);
    setTenantsError(null);
    try {
      const res = await platformFetch('/api/admin/tenant', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load tenants.');
      }
      const list: TenantInfo[] = Array.isArray(data.tenants)
        ? data.tenants
            .map((tenant: { id: number | string; username?: unknown; areas?: unknown }) => ({
              id: typeof tenant.id === 'number' ? tenant.id : Number(tenant.id),
              username: typeof tenant.username === 'string' ? tenant.username : '',
              areas: Array.isArray(tenant.areas)
                ? tenant.areas
                    .filter((a: unknown): a is string => typeof a === 'string')
                    .map((a) => a.trim())
                    .filter(Boolean)
                : [],
            }))
            .filter(
              (tenant: TenantInfo) =>
                Number.isFinite(tenant.id) && tenant.username.length > 0
            )
        : [];
      setTenants(list);
      setTenantAreaInputs((prev) => {
        const next: Record<number, string> = {};
        list.forEach((tenant) => {
          next[tenant.id] = prev[tenant.id] ?? '';
        });
        return next;
      });
    } catch (err) {
      setTenantsError(
        err instanceof Error ? err.message : 'Failed to load tenants. Please try again.'
      );
    } finally {
      setTenantsLoading(false);
    }
  }, [tenantLocked]);

  useEffect(() => {
    if (!viewTenantsOpen || tenantLocked) return;
    void fetchTenants();
  }, [viewTenantsOpen, tenantLocked, fetchTenants]);

  async function saveTenantAreas(tenantId: number, nextAreas: string[]) {
    updateTenantActionState(tenantId, { saving: true, error: null });
    try {
      const res = await platformFetch(`/api/admin/tenant/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areas: nextAreas }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update tenant areas.');
      }
      const updatedAreas =
        Array.isArray(data.tenant?.areas) && data.tenant.areas.every((a: unknown) => typeof a === 'string')
          ? (data.tenant.areas as string[])
          : nextAreas;
      setTenants((prev) =>
        prev.map((tenant) =>
          tenant.id === tenantId ? { ...tenant, areas: updatedAreas } : tenant
        )
      );
      setTenantAreaInputs((prev) => ({ ...prev, [tenantId]: '' }));
      updateTenantActionState(tenantId, { saving: false, error: null });
    } catch (err) {
      updateTenantActionState(tenantId, {
        saving: false,
        error: err instanceof Error ? err.message : 'Failed to update tenant areas.',
      });
    }
  }

  function handleRemoveTenantArea(tenantId: number, areaValue: string) {
    const target = tenants.find((tenant) => tenant.id === tenantId);
    if (!target) return;
    const nextAreas = target.areas.filter((area) => area !== areaValue);
    void saveTenantAreas(tenantId, nextAreas);
  }

  function handleAddTenantArea(tenantId: number) {
    const target = tenants.find((tenant) => tenant.id === tenantId);
    if (!target) return;
    const candidate = (tenantAreaInputs[tenantId] ?? '').trim();
    if (!candidate || target.areas.includes(candidate)) return;
    const nextAreas = [...target.areas, candidate];
    void saveTenantAreas(tenantId, nextAreas);
  }

  function openTenantDelete(tenant: TenantInfo) {
    setTenantToDelete(tenant);
    setTenantDeleteError(null);
  }

  async function confirmDeleteTenant() {
    if (!tenantToDelete) return;
    const targetId = tenantToDelete.id;
    setTenantDeleteLoading(true);
    setTenantDeleteError(null);
    try {
      const res = await platformFetch(`/api/admin/tenant/${targetId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete tenant.');
      }
      setTenants((prev) => prev.filter((tenant) => tenant.id !== targetId));
      setTenantActions((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      setTenantAreaInputs((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      setTenantToDelete(null);
    } catch (err) {
      setTenantDeleteError(
        err instanceof Error ? err.message : 'Failed to delete tenant. Please try again.'
      );
    } finally {
      setTenantDeleteLoading(false);
    }
  }

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
                  <a
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                    href="/devices/manage"
                    onClick={() => setMenuOpen(false)}
                  >
                    Manage Devices
                  </a>
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
                Remote access can be enabled from your iOS/Android phone or the Dinodia Kiosk.
              </p>
              <div
                className={`mt-3 rounded-lg border px-4 py-3 text-xs ${remoteStatusToneClass}`}
              >
                <p className="font-medium">{remoteStatusCopy}</p>
                {showRemoteActions && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <a
                      href={IOS_APP_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                    >
                      Download on iOS
                    </a>
                    <a
                      href={ANDROID_APP_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                    >
                      Get it on Android
                    </a>
                    <a
                      href={KIOSK_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800"
                    >
                      Purchase Dinodia Kiosk
                    </a>
                  </div>
                )}
                {remoteStatus.status !== 'checking' && (
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1 rounded-full border border-current px-3 py-1 text-[11px] font-medium hover:bg-white/20"
                    onClick={() => void refreshRemoteStatus()}
                  >
                    Re-check status
                  </button>
                )}
              </div>
              {alexaDevicesAvailable && (
                <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-900">
                  <p className="text-sm font-semibold">
                    Congratulations your tenants can now connect their Dinodia smart home devices to Alexa!
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl lg:col-span-2">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500"
            onClick={() => setViewTenantsOpen((prev) => !prev)}
          >
            <span>Home setup – view tenants</span>
            <span className="text-[11px] font-normal text-slate-400">
              {viewTenantsOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          {tenantLocked && (
            <p className="mx-4 mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {TENANT_LOCKED_MESSAGE}
            </p>
          )}
          {viewTenantsOpen && (
            <div
              className={`px-4 pb-4 pt-1 border-t border-slate-100 ${
                tenantLocked ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-600">
                  View tenants in this home and manage their areas or delete accounts.
                </p>
                <button
                  type="button"
                  onClick={() => void fetchTenants()}
                  disabled={tenantsLoading || tenantLocked}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {tenantsLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {tenantsError && (
                <p className="mt-2 text-xs text-red-600">{tenantsError}</p>
              )}
              {tenantsLoading ? (
                <p className="mt-3 text-xs text-slate-600">Loading tenants…</p>
              ) : tenants.length === 0 ? (
                <p className="mt-3 text-xs text-slate-600">No tenants yet.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {tenants.map((tenant) => {
                    const tenantState = tenantActions[tenant.id] ?? {
                      saving: false,
                      error: null,
                    };
                    const selectedArea = tenantAreaInputs[tenant.id] ?? '';
                    return (
                      <div
                        key={tenant.id}
                        className="rounded-lg border border-slate-200 p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {tenant.username}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {tenant.areas.length > 0 ? (
                                tenant.areas.map((area) => (
                                  <span
                                    key={area}
                                    className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-700"
                                  >
                                    <span>{area}</span>
                                    <button
                                      type="button"
                                      className="text-slate-500 hover:text-slate-700"
                                      onClick={() => handleRemoveTenantArea(tenant.id, area)}
                                      aria-label={`Remove ${area}`}
                                      disabled={tenantLocked || tenantState.saving}
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))
                              ) : (
                                <span className="text-[11px] text-slate-500">
                                  No areas assigned.
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              className="w-full min-w-[200px] border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                              value={selectedArea}
                              onChange={(e) =>
                                setTenantAreaInputs((prev) => ({
                                  ...prev,
                                  [tenant.id]: e.target.value,
                                }))
                              }
                              disabled={
                                tenantLocked || tenantState.saving || availableAreas.length === 0
                              }
                            >
                              <option value="">
                                {availableAreas.length > 0
                                  ? 'Select an area'
                                  : 'No areas available'}
                              </option>
                              {availableAreas.map((area) => (
                                <option key={area} value={area}>
                                  {area}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleAddTenantArea(tenant.id)}
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
                              aria-label="Add area"
                              disabled={
                                tenantLocked || tenantState.saving || !selectedArea.trim()
                              }
                            >
                              <span className="text-lg leading-none">+</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openTenantDelete(tenant)}
                              className="inline-flex items-center justify-center rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                              disabled={tenantLocked || tenantState.saving}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {tenantState.error && (
                          <p className="mt-2 text-xs text-red-600">{tenantState.error}</p>
                        )}
                        {tenantState.saving && !tenantLocked && (
                          <p className="mt-2 text-[11px] text-slate-500">Saving changes…</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border border-slate-200 rounded-xl lg:col-span-2">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500"
            onClick={() => setAddTenantOpen((prev) => !prev)}
          >
            <span>Home setup – add tenant</span>
            <span className="text-[11px] font-normal text-slate-400">
              {addTenantOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          {tenantLocked && (
            <p className="mx-4 mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {TENANT_LOCKED_MESSAGE}
            </p>
          )}
          {addTenantOpen && (
            <div
              className={`px-4 pb-4 pt-1 border-t border-slate-100 ${
                tenantLocked ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              <form onSubmit={handleTenantSubmit} className="mt-3 space-y-3">
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
                    Choose one or more rooms to give access to.
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
          )}
        </div>

        <div
          className={`border border-slate-200 rounded-xl p-4 lg:col-span-2 ${
            deregisterLocked ? 'bg-slate-50 opacity-70 pointer-events-none' : ''
          }`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Deregister Property</h2>
              <p className="text-[11px] text-slate-500 mt-1">
                Issue a one-time claim code for the next homeowner.
              </p>
            </div>
            <button
              type="button"
              onClick={openSellingModal}
              disabled={sellingLoading || deregisterLocked}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {sellingClaimCode ? 'View claim code' : 'Deregister Property'}
            </button>
          </div>
          {deregisterLocked && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Remote access must be enabled for you to deregister your smart home from this
              website. To deregister your smart home without paying for remote access you
              will have to use your iOS/Android phone or the Dinodia Kiosk.
            </p>
          )}
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

      {tenantToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Delete tenant</h3>
                <p className="text-xs text-slate-500">
                  Remove tenant access, devices they added via Dinodia, and their automations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTenantToDelete(null)}
                disabled={tenantDeleteLoading}
                className="text-slate-500 hover:text-slate-700"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-700">
              Are you sure you want to delete{' '}
              <span className="font-semibold">{tenantToDelete.username}</span>?
            </p>
            {tenantDeleteError && (
              <p className="mt-2 text-xs text-red-600">{tenantDeleteError}</p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
                onClick={() => void confirmDeleteTenant()}
                disabled={tenantDeleteLoading}
              >
                {tenantDeleteLoading ? 'Deleting…' : 'Delete tenant'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                onClick={() => setTenantToDelete(null)}
                disabled={tenantDeleteLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {sellingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Deregister Property</h3>
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
                    <p className="text-sm font-semibold">
                      Deregister your whole household (Homeowner + Occupiers)
                    </p>
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
                    <p className="text-sm font-semibold">
                      Deregister yourself but keep all occupiers control active (Only a household
                      owner change)
                    </p>
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
