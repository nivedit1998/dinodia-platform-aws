'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type HomeSummary = {
  homeId: number;
  installedAt: string;
};

type HomeDetail = {
  homeId: number;
  installedAt: string;
  homeAccessApproved: boolean;
  credentials?: {
    haUsername: string;
    haPassword: string;
    baseUrl: string;
    cloudUrl: string | null;
    longLivedToken: string;
    bootstrapSecret?: string;
  };
  homeSupportRequest?: RequestSummary | null;
  hubStatus: {
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
  homeowners: { email: string | null; username: string }[];
  tenants: { email: string | null; username: string; areas: string[] }[];
  alexaEnabled: { email: string | null; username: string }[];
  users: { id: number; username: string; email: string | null; role: string; supportRequest?: RequestSummary | null }[];
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

  const [expandedHomeId, setExpandedHomeId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, HomeDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<number, boolean>>({});
  const [detailError, setDetailError] = useState<Record<number, string | null>>({});

  const [homeRequests, setHomeRequests] = useState<Record<number, RequestTracking>>({});
  const [userRequests, setUserRequests] = useState<Record<string, RequestTracking>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadHomes() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/installer/home-support/homes');
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load homes.');
        if (!cancelled) setHomes(data.homes ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load homes.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadHomes();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadDetail(homeId: number) {
    setDetailError((prev) => ({ ...prev, [homeId]: null }));
    setDetailLoading((prev) => ({ ...prev, [homeId]: true }));
    try {
      const res = await fetch(`/api/installer/home-support/homes/${homeId}`);
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load details.');
      setDetails((prev) => ({ ...prev, [homeId]: data }));
    } catch (err) {
      setDetailError((prev) => ({
        ...prev,
        [homeId]: err instanceof Error ? err.message : 'Failed to load details.',
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
      const res = await fetch('/api/installer/support/home-access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Request failed');
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
      const res = await fetch('/api/installer/support/user-access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeId, userId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Request failed');
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
        const res = await fetch(`/api/installer/support/requests/${requestId}/status`);
        const data = await res.json();
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
    const res = await fetch(`/api/installer/support/requests/${requestId}/impersonate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !data.redirectTo) {
      alert(data?.error || 'Impersonation failed');
      return;
    }
    window.location.href = data.redirectTo;
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

          {loading && <p className="mt-4 text-sm text-slate-600">Loading homes…</p>}
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
                              {detail.homeowners.length === 0 && <li>None</li>}
                              {detail.homeowners.map((u) => (
                                <li key={u.username}>{u.email ?? 'No email'} ({u.username})</li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">Tenants</p>
                            <ul className="mt-2 space-y-1 text-sm text-slate-800">
                              {detail.tenants.length === 0 && <li>None</li>}
                              {detail.tenants.map((u) => (
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
                              {detail.alexaEnabled.length === 0 && <li>None</li>}
                              {detail.alexaEnabled.map((u) => (
                                <li key={u.username}>{u.email ?? 'No email'} ({u.username})</li>
                              ))}
                            </ul>
                          </section>

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <p className="text-sm font-semibold text-slate-900">User Support</p>
                            <div className="mt-2 space-y-3">
                                {detail.users.map((user) => {
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && homesSorted.length === 0 && (
              <p className="text-sm text-slate-600">No homes found for this installer.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
