'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { friendlyUnknownError } from '@/lib/clientError';
import { platformFetchJson } from '@/lib/platformFetchClient';

type HomeSummary = {
  homeId: number;
  installedAt: string;
};

type HomeDetail = {
  homeId: number;
  installedAt: string;
  homeAccessApproved: boolean;
  homeownerPolicyEmail?: {
    acceptanceId: string;
    policyVersion: string;
    acceptedAt: string;
    homeownerUsername: string;
    homeownerEmail: string | null;
    homeownerStatus: RequestStatus | 'SENT' | 'FAILED' | null;
    installerEmail: string | null;
    installerStatus: RequestStatus | 'SENT' | 'FAILED' | null;
    canResend: boolean;
  } | null;
  credentials?: {
    haUsername: string;
    haPassword: string;
    baseUrl: string;
    cloudUrl: string | null;
    longLivedToken: string;
    bootstrapSecret?: string;
  };
  homeSupportRequest?: RequestSummary | null;
  hubStatus?: {
    serial: string | null;
    lastSeenAt: string | null;
    installedAt: string;
    platformSyncEnabled?: boolean;
    rotateEveryMinutes?: number | null;
    graceMinutes?: number | null;
    publishedHubTokenVersion?: number | null;
    lastAckedHubTokenVersion?: number | null;
    lastReportedLanBaseUrl?: string | null;
    lastReportedLanBaseUrlAt?: string | null;
  } | null;
  homeowners?: { email: string | null; username: string }[];
  tenants?: { email: string | null; username: string; areas: string[] }[];
  alexaEnabled?: { email: string | null; username: string }[];
  users?: { id: number; username: string; email: string | null; role: string; supportRequest?: RequestSummary | null }[];
};

type RequestStatus = 'PENDING' | 'APPROVED' | 'EXPIRED' | 'CONSUMED' | 'NOT_FOUND';

type RequestSummary = {
  requestId: string;
  status: RequestStatus;
  approvedAt: string | null;
  validUntil: string | null;
  expiresAt: string | null;
};

type RequestTracking = {
  status: RequestStatus | 'IDLE';
  requestId?: string;
  expiresAt?: string | null;
  approvedAt?: string | null;
  validUntil?: string | null;
};

const DEFAULT_HOME_ACCESS_REASON = 'Installer requested temporary home troubleshooting access.';
const DEFAULT_USER_ACCESS_REASON = 'Installer requested temporary user impersonation for troubleshooting.';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function HomeSupportClient({ installerName }: { installerName: string }) {
  const [homes, setHomes] = useState<HomeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupHomeId, setLookupHomeId] = useState('');
  const [lookupSerial, setLookupSerial] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const [expandedHomeId, setExpandedHomeId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, HomeDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<number, boolean>>({});
  const [detailError, setDetailError] = useState<Record<number, string | null>>({});

  const [homeRequests, setHomeRequests] = useState<Record<number, RequestTracking>>({});
  const [userRequests, setUserRequests] = useState<Record<string, RequestTracking>>({});
  const [resendingPolicyEmail, setResendingPolicyEmail] = useState<Record<number, boolean>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function lookupHomes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const homeId = lookupHomeId.trim();
    const serial = lookupSerial.trim();

    if ((homeId && serial) || (!homeId && !serial)) {
      setError('Enter either Home ID or Hub Serial.');
      return;
    }
    if (homeId && !/^\d+$/.test(homeId)) {
      setError('Home ID must be a positive number.');
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const params = new URLSearchParams();
      if (homeId) params.set('homeId', homeId);
      if (serial) params.set('serial', serial);
      const data = await platformFetchJson<{ ok?: boolean; homes?: HomeSummary[] }>(
        `/api/installer/home-support/homes?${params.toString()}`,
        undefined,
        'Failed to load homes.'
      );
      if (!data?.ok) throw new Error('Failed to load homes.');
      const nextHomes = data.homes ?? [];
      setHomes(nextHomes);
      setExpandedHomeId(null);
      setDetails({});
      setDetailLoading({});
      setDetailError({});
      setHomeRequests({});
      setUserRequests({});
      if (nextHomes.length === 0) {
        setError('No home found for that Home ID or Hub Serial.');
      }
    } catch (err) {
      setError(friendlyUnknownError(err, 'Failed to load homes.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(homeId: number) {
    setDetailError((prev) => ({ ...prev, [homeId]: null }));
    setDetailLoading((prev) => ({ ...prev, [homeId]: true }));
    try {
      const data = await platformFetchJson<HomeDetail & { ok?: boolean }>(
        `/api/installer/home-support/homes/${homeId}`,
        undefined,
        'Failed to load details.'
      );
      if (!data?.ok) throw new Error('Failed to load details.');
      setDetails((prev) => ({ ...prev, [homeId]: data }));
    } catch (err) {
      setDetailError((prev) => ({
        ...prev,
        [homeId]: friendlyUnknownError(err, 'Failed to load details.'),
      }));
    } finally {
      setDetailLoading((prev) => ({ ...prev, [homeId]: false }));
    }
  }

  function toggleHome(homeId: number) {
    const next = expandedHomeId === homeId ? null : homeId;
    setExpandedHomeId(next);
    if (next && !details[next]) {
      void loadDetail(next);
    }
  }

  async function requestHomeAccess(homeId: number) {
    setHomeRequests((prev) => ({ ...prev, [homeId]: { status: 'PENDING' } }));
    try {
      const data = await platformFetchJson<{
        ok?: boolean;
        requestId?: string;
        expiresAt?: string | null;
        approvedAt?: string | null;
        validUntil?: string | null;
      }>(
        '/api/installer/support/home-access/request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            homeId,
            reason: DEFAULT_HOME_ACCESS_REASON,
            scope: 'VIEW_CREDENTIALS',
          }),
        },
        'Request failed.'
      );
      if (!data?.ok) throw new Error('Request failed.');
      setHomeRequests((prev) => ({
        ...prev,
        [homeId]: {
          status: 'PENDING',
          requestId: data.requestId,
          expiresAt: data.expiresAt,
          approvedAt: data.approvedAt ?? null,
          validUntil: data.validUntil ?? null,
        },
      }));
      if (data.requestId) {
        void pollStatus(data.requestId, (status, info) => {
          setHomeRequests((prev) => ({
            ...prev,
            [homeId]: { ...(prev[homeId] || {}), status, ...info },
          }));
          if (status === 'APPROVED') {
            void loadDetail(homeId);
          }
        });
      }
    } catch {
      setHomeRequests((prev) => ({
        ...prev,
        [homeId]: { status: 'NOT_FOUND' },
      }));
    }
  }

  async function requestUserAccess(homeId: number, userId: number) {
    const key = `${homeId}:${userId}`;
    setUserRequests((prev) => ({ ...prev, [key]: { status: 'PENDING' } }));
    try {
      const data = await platformFetchJson<{
        ok?: boolean;
        requestId?: string;
        expiresAt?: string | null;
        approvedAt?: string | null;
        validUntil?: string | null;
      }>(
        '/api/installer/support/user-access/request',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            homeId,
            userId,
            reason: DEFAULT_USER_ACCESS_REASON,
            scope: 'IMPERSONATE_USER',
          }),
        },
        'Request failed.'
      );
      if (!data?.ok) throw new Error('Request failed.');
      setUserRequests((prev) => ({
        ...prev,
        [key]: {
          status: 'PENDING',
          requestId: data.requestId,
          expiresAt: data.expiresAt,
          approvedAt: data.approvedAt ?? null,
          validUntil: data.validUntil ?? null,
        },
      }));
      if (data.requestId) {
        void pollStatus(data.requestId, (status, info) => {
          setUserRequests((prev) => ({
            ...prev,
            [key]: { ...(prev[key] || {}), status, ...info },
          }));
        });
      }
    } catch {
      setUserRequests((prev) => ({
        ...prev,
        [key]: { status: 'NOT_FOUND' },
      }));
    }
  }

  async function pollStatus(
    requestId: string,
    onUpdate: (status: RequestStatus, info: Partial<RequestTracking>) => void
  ) {
    let done = false;
    async function loop() {
      if (done) return;
      try {
        const data = await platformFetchJson<{
          status?: RequestStatus;
          approvedAt?: string | null;
          validUntil?: string | null;
          expiresAt?: string | null;
        }>(`/api/installer/support/requests/${requestId}/status`, undefined, 'Unable to load request status.');
        const status: RequestStatus = data?.status || 'NOT_FOUND';
        onUpdate(status, {
          approvedAt: data?.approvedAt ?? null,
          validUntil: data?.validUntil ?? null,
          expiresAt: data?.expiresAt ?? null,
          requestId,
        });
        if (status === 'PENDING') {
          setTimeout(loop, 4000);
        } else {
          done = true;
        }
      } catch {
        done = true;
      }
    }
    void loop();
  }

  async function impersonate(requestId: string) {
    try {
      const data = await platformFetchJson<{ ok?: boolean; redirectTo?: string }>(
        `/api/installer/support/requests/${requestId}/impersonate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        'Impersonation failed.'
      );
      if (!data?.ok || !data.redirectTo) {
        alert('Impersonation failed.');
        return;
      }
      window.location.href = data.redirectTo;
    } catch (err) {
      alert(friendlyUnknownError(err, 'Impersonation failed.'));
    }
  }

  async function resendPolicyConfirmationEmail(homeId: number) {
    const reason = window.prompt('Reason for resend (required):', 'Homeowner requested policy confirmation resend');
    if (!reason || !reason.trim()) return;

    setResendingPolicyEmail((prev) => ({ ...prev, [homeId]: true }));
    try {
      const data = await platformFetchJson<{
        ok?: boolean;
        error?: string;
        allSent?: boolean;
      }>(
        `/api/installer/home-support/homes/${homeId}/policy-email/resend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
        'Failed to resend homeowner policy confirmation email.'
      );
      if (!data?.ok) throw new Error(data?.error || 'Failed to resend homeowner policy confirmation email.');
      await loadDetail(homeId);
      alert(data.allSent ? 'Homeowner policy confirmation email resent successfully.' : 'Resend attempted. Some recipients still failed.');
    } catch (err) {
      alert(friendlyUnknownError(err, 'Failed to resend homeowner policy confirmation email.'));
    } finally {
      setResendingPolicyEmail((prev) => ({ ...prev, [homeId]: false }));
    }
  }

  const homesSorted = useMemo(
    () => [...homes].sort((a, b) => b.homeId - a.homeId),
    [homes]
  );

  function renderCountdown(validUntil?: string | null) {
    if (!validUntil) return null;
    const msRemaining = new Date(validUntil).getTime() - now;
    if (msRemaining <= 0) return <span className="text-xs text-rose-600">Expired</span>;
    const totalSeconds = Math.floor(msRemaining / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return <span className="text-xs text-emerald-700">{minutes}:{seconds} remaining</span>;
  }

  function CredentialRow({ label, value }: { label: string; value: string | null | undefined }) {
    return (
      <div className="flex flex-col">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="font-mono text-sm text-slate-900 break-all">{value ?? '—'}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">Installer</p>
            <p className="text-lg font-semibold text-slate-900">{installerName}</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/installer/provision"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Provision hubs
            </Link>
            <Link
              href="/installer/login"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </Link>
          </div>
        </header>

        <div className="rounded-xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Home Support</h1>
              <p className="text-sm text-slate-600">Request approval to view credentials and impersonate users.</p>
            </div>
          </div>

          <form onSubmit={lookupHomes} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lookup Home</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                type="text"
                value={lookupHomeId}
                onChange={(e) => setLookupHomeId(e.target.value)}
                placeholder="Home ID"
                className="min-w-[140px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={lookupSerial}
                onChange={(e) => setLookupSerial(e.target.value)}
                placeholder="Hub Serial"
                className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Find home
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Enter either a Home ID or a Hub Serial. Browsing all homes is disabled.
            </p>
          </form>

          {loading && <p className="mt-4 text-sm text-slate-600">Searching homes…</p>}
          {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

          <div className="mt-6 space-y-4">
            {homesSorted.map((home) => {
              const isOpen = expandedHomeId === home.homeId;
              const detail = details[home.homeId];
              const dLoading = detailLoading[home.homeId];
              const dError = detailError[home.homeId];
              const homeReq = detail?.homeSupportRequest
                ? {
                    status: detail.homeSupportRequest.status as RequestStatus,
                    requestId: detail.homeSupportRequest.requestId,
                    approvedAt: detail.homeSupportRequest.approvedAt,
                    validUntil: detail.homeSupportRequest.validUntil,
                    expiresAt: detail.homeSupportRequest.expiresAt,
                  }
                : homeRequests[home.homeId] || { status: 'IDLE' };
              return (
                <div
                  key={home.homeId}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Home #{home.homeId}</p>
                      <p className="text-xs text-slate-600">Installed {formatDate(home.installedAt)}</p>
                    </div>
                    <button
                      onClick={() => toggleHome(home.homeId)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {isOpen ? 'Hide details' : 'View details'}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-4 space-y-4">
                      {dLoading && <p className="text-sm text-slate-600">Loading details…</p>}
                      {dError && <p className="text-sm text-rose-600">{dError}</p>}

                      {detail && (
                        <div className="space-y-4">
                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">Homeowner Policy Confirmation</p>
                              {detail.homeownerPolicyEmail?.canResend && (
                                <button
                                  onClick={() => resendPolicyConfirmationEmail(home.homeId)}
                                  disabled={Boolean(resendingPolicyEmail[home.homeId])}
                                  className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                >
                                  {resendingPolicyEmail[home.homeId] ? 'Resending…' : 'Resend confirmation email'}
                                </button>
                              )}
                            </div>
                            {!detail.homeownerPolicyEmail ? (
                              <p className="mt-2 text-xs text-slate-600">No homeowner policy acceptance found yet.</p>
                            ) : (
                              <div className="mt-2 space-y-1 text-xs text-slate-700">
                                <p>
                                  Version: <span className="font-semibold">{detail.homeownerPolicyEmail.policyVersion}</span>
                                </p>
                                <p>
                                  Accepted at: <span className="font-semibold">{formatDate(detail.homeownerPolicyEmail.acceptedAt)}</span>
                                </p>
                                <p>
                                  Homeowner: <span className="font-semibold">{detail.homeownerPolicyEmail.homeownerUsername}</span>
                                  {detail.homeownerPolicyEmail.homeownerEmail ? ` (${detail.homeownerPolicyEmail.homeownerEmail})` : ''}
                                </p>
                                <p>
                                  Homeowner email status:{' '}
                                  <span className="font-semibold">{detail.homeownerPolicyEmail.homeownerStatus ?? 'Not sent'}</span>
                                </p>
                                <p>
                                  Installer email status:{' '}
                                  <span className="font-semibold">{detail.homeownerPolicyEmail.installerStatus ?? 'Not sent'}</span>
                                </p>
                              </div>
                            )}
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">Home Support</p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-600">
                                  Status:{' '}
                                  {homeReq.status === 'APPROVED'
                                    ? 'Approved'
                                    : homeReq.status === 'PENDING'
                                    ? 'Pending'
                                    : homeReq.status === 'EXPIRED'
                                    ? 'Expired'
                                    : 'Not requested'}
                                </span>
                                {homeReq.status === 'APPROVED' && renderCountdown(homeReq.validUntil)}
                                {homeReq.status === 'EXPIRED' && (
                                  <span className="text-xs text-rose-600">Expired</span>
                                )}
                                {homeReq.status !== 'APPROVED' && homeReq.status !== 'PENDING' && (
                                  <button
                                    onClick={() => requestHomeAccess(home.homeId)}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    Request home access approval
                                  </button>
                                )}
                                {homeReq.status === 'PENDING' && !detail.homeAccessApproved && (
                                  <button
                                    onClick={() => requestHomeAccess(home.homeId)}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    Re-request
                                  </button>
                                )}
                              </div>
                            </div>
                            {(homeReq.status === 'APPROVED') ? (
                              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                <CredentialRow label="HA Username" value={detail.credentials?.haUsername} />
                                <CredentialRow label="HA Password" value={detail.credentials?.haPassword} />
                                <CredentialRow label="Base URL" value={detail.credentials?.baseUrl} />
                                <CredentialRow label="Cloud URL" value={detail.credentials?.cloudUrl} />
                                <CredentialRow label="Long-lived token" value={detail.credentials?.longLivedToken} />
                                <CredentialRow label="Bootstrap secret" value={detail.credentials?.bootstrapSecret} />
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-slate-600">
                                Request homeowner approval to view credentials.
                              </p>
                            )}
                          </section>

                          {detail.homeAccessApproved ? (
                            <>
                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Hub Local connection Status</p>
                            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                              <CredentialRow label="Serial" value={detail.hubStatus?.serial ?? null} />
                              <CredentialRow label="Last seen" value={formatDate(detail.hubStatus?.lastSeenAt)} />
                              <CredentialRow
                                label="Last reported LAN base URL"
                                value={detail.hubStatus?.lastReportedLanBaseUrl ?? null}
                              />
                              <CredentialRow
                                label="Last reported LAN base URL at"
                                value={formatDate(detail.hubStatus?.lastReportedLanBaseUrlAt)}
                              />
                              <CredentialRow
                                label="Token version (published/acked)"
                                value={
                                  detail.hubStatus?.publishedHubTokenVersion != null
                                    ? `${detail.hubStatus.publishedHubTokenVersion} / ${detail.hubStatus?.lastAckedHubTokenVersion ?? '—'}`
                                    : '—'
                                }
                              />
                            </div>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Current Homeowner</p>
                            <ul className="mt-2 space-y-1 text-sm text-slate-800">
                              {(detail.homeowners ?? []).length === 0 && <li>None</li>}
                              {(detail.homeowners ?? []).map((u) => (
                                <li key={u.username}>{u.email ?? 'No email'} ({u.username})</li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Tenants</p>
                            <ul className="mt-2 space-y-1 text-sm text-slate-800">
                              {(detail.tenants ?? []).length === 0 && <li>None</li>}
                              {(detail.tenants ?? []).map((u) => (
                                <li key={u.username}>
                                  {u.email ?? 'No email'} ({u.username})
                                  {u.areas.length > 0 && (
                                    <span className="text-xs text-slate-600"> — Areas: {u.areas.join(', ')}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Alexa Enabled</p>
                            <ul className="mt-2 space-y-1 text-sm text-slate-800">
                              {(detail.alexaEnabled ?? []).length === 0 && <li>None</li>}
                              {(detail.alexaEnabled ?? []).map((u) => (
                                <li key={u.username}>{u.email ?? 'No email'} ({u.username})</li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">User Support</p>
                            <div className="mt-2 space-y-3">
                                {(detail.users ?? []).map((user) => {
                                  const key = `${home.homeId}:${user.id}`;
                                  const uReq = user.supportRequest
                                    ? {
                                        status: user.supportRequest.status as RequestStatus,
                                        requestId: user.supportRequest.requestId,
                                        approvedAt: user.supportRequest.approvedAt,
                                        validUntil: user.supportRequest.validUntil,
                                        expiresAt: user.supportRequest.expiresAt,
                                      }
                                    : userRequests[key] || { status: 'IDLE' as RequestStatus | 'IDLE' };
                                  const approved =
                                    uReq.status === 'APPROVED' &&
                                    (!uReq.validUntil || new Date(uReq.validUntil).getTime() > now);
                                  return (
                                    <div key={user.id} className="rounded border border-slate-200 p-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-sm font-semibold text-slate-800">
                                          {user.email ?? user.username} — {user.role}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                          <span className="text-xs text-slate-600">
                                            Status:{' '}
                                            {approved
                                              ? 'Approved'
                                              : uReq.status === 'PENDING'
                                              ? 'Pending'
                                              : uReq.status === 'EXPIRED'
                                              ? 'Expired'
                                              : 'Not requested'}
                                          </span>
                                          {uReq.status === 'APPROVED' && renderCountdown(uReq.validUntil)}
                                          {!approved && (
                                            <button
                                              onClick={() => requestUserAccess(home.homeId, user.id)}
                                              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                            >
                                              Request user remote access approval
                                            </button>
                                          )}
                                        {approved && uReq.requestId && (
                                          <button
                                            onClick={() => impersonate(uReq.requestId!)}
                                            className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                                          >
                                            Impersonate
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                            </>
                          ) : (
                            <p className="text-xs text-slate-600">
                              Home and resident details stay hidden until homeowner approval is active.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && homesSorted.length === 0 && (
              <p className="text-sm text-slate-600">
                {hasSearched
                  ? 'No homes found for that lookup.'
                  : 'Search using Home ID or Hub Serial to begin.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
