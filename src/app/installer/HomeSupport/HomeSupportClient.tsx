'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Role } from '@prisma/client';
import QRCode from 'qrcode';
import { friendlyUnknownError } from '@/lib/clientError';
import { platformFetchJson } from '@/lib/platformFetchClient';
import {
  canAccessGdpr,
  canAccessProvision,
  canAccessSupportAuditSection,
  getCompanyRoleLabel,
} from '@/lib/companyPortalAccess';

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

type RoomSummary = {
  id: string;
  displayName: string;
  haAreaName: string;
  haAreaNameOriginal: string;
  qrKeyVersion: number;
  status: string;
  qrPayload: string;
  qrDataUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
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

const supportHubLinks = [
  { label: 'ISO 27001 scope statement', href: '/installer/ISO27001_SCOPE', note: 'Systems, people, locations, suppliers' },
  { label: 'ISO 27001 risk register', href: '/installer/ISO27001_RISK_REGISTER', note: 'Risk owners, treatment, residual risk' },
  { label: 'ISO 27001 supplier register', href: '/installer/ISO27001_SUPPLIER_REGISTER', note: 'Vendors, DPAs, review dates' },
  { label: 'ISO 27001 incident response', href: '/installer/ISO27001_INCIDENT_RESPONSE', note: 'Triage, containment, notification' },
  { label: 'ISO 27001 internal audit', href: '/installer/ISO27001_INTERNAL_AUDIT', note: 'Audit schedule and corrective actions' },
  { label: 'ISO 27001 certification roadmap', href: '/installer/ISO27001_CERTIFICATION_ROADMAP', note: 'Gap assessment to Stage 2' },
];

const supportHubMatrix = [
  {
    title: 'Audit ownership',
    body: 'Use this hub to assign evidence owners, due dates, and review cadence for audit work.',
  },
  {
    title: 'Incident response',
    body: 'Use this hub to capture triage, containment, notification, and lessons learned for incidents.',
  },
  {
    title: 'Supplier follow-up',
    body: 'Track vendor contacts, contract status, and DPA review dates without storing customer PII.',
  },
  {
    title: 'Support access',
    body: 'Continue using the existing approval and impersonation flows for customer support work.',
  },
];

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function HomeSupportClient({ installerName, role }: { installerName: string; role: Role }) {
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

  const [roomsByHomeId, setRoomsByHomeId] = useState<Record<number, RoomSummary[]>>({});
  const [roomsLoading, setRoomsLoading] = useState<Record<number, boolean>>({});
  const [roomsError, setRoomsError] = useState<Record<number, string | null>>({});
  const [haAreasByHomeId, setHaAreasByHomeId] = useState<Record<number, string[]>>({});
  const [addingRoom, setAddingRoom] = useState<Record<number, boolean>>({});
  const [newRoomDisplayName, setNewRoomDisplayName] = useState<Record<number, string>>({});
  const [newRoomHaAreaName, setNewRoomHaAreaName] = useState<Record<number, string>>({});
  const canSeeAuditSection = canAccessSupportAuditSection(role);
  const canSeeAuditQuickLinks = role === Role.CXO;

  async function generateRoomQrDataUrl(payload: string) {
    return QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
    });
  }

  async function loadAllHomes() {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const data = await platformFetchJson<{ ok?: boolean; homes?: HomeSummary[] }>(
        '/api/installer/home-support/homes',
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
        setError('No homes found yet.');
      }
    } catch (err) {
      setError(friendlyUnknownError(err, 'Failed to load homes.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void loadAllHomes();
  }, []);

  async function loadRooms(homeId: number) {
    setRoomsError((prev) => ({ ...prev, [homeId]: null }));
    setRoomsLoading((prev) => ({ ...prev, [homeId]: true }));
    try {
      const data = await platformFetchJson<{ ok?: boolean; rooms?: RoomSummary[] }>(
        `/api/installer/home-support/homes/${homeId}/rooms`,
        { cache: 'no-store' },
        'Failed to load rooms.'
      );
      const rooms = Array.isArray(data.rooms) ? data.rooms : [];
      const withQr = await Promise.all(
        rooms.map(async (room) => {
          try {
            const qrDataUrl = room.qrPayload ? await generateRoomQrDataUrl(room.qrPayload) : null;
            return { ...room, qrDataUrl };
          } catch {
            return { ...room, qrDataUrl: null };
          }
        })
      );
      setRoomsByHomeId((prev) => ({ ...prev, [homeId]: withQr }));
    } catch (err) {
      setRoomsError((prev) => ({ ...prev, [homeId]: friendlyUnknownError(err, 'Failed to load rooms.') }));
    } finally {
      setRoomsLoading((prev) => ({ ...prev, [homeId]: false }));
    }
  }

  async function loadHaAreas(homeId: number) {
    try {
      const data = await platformFetchJson<{ ok?: boolean; areas?: string[] }>(
        `/api/installer/home-support/homes/${homeId}/ha-areas`,
        { cache: 'no-store' },
        'Failed to load areas.'
      );
      const areas = Array.isArray(data.areas) ? data.areas.filter((a) => typeof a === 'string' && a.trim().length > 0) : [];
      setHaAreasByHomeId((prev) => ({ ...prev, [homeId]: Array.from(new Set(areas)) }));
      setNewRoomHaAreaName((prev) => {
        if (typeof prev[homeId] === 'string' && prev[homeId]!.trim()) return prev;
        return { ...prev, [homeId]: areas[0] ?? '' };
      });
    } catch {
      // best effort
    }
  }

  async function addRoom(homeId: number) {
    const displayName = (newRoomDisplayName[homeId] ?? '').trim();
    const haAreaName = (newRoomHaAreaName[homeId] ?? '').trim();
    if (!displayName || !haAreaName) {
      alert('Enter both display name and HA area name.');
      return;
    }
    setAddingRoom((prev) => ({ ...prev, [homeId]: true }));
    try {
      await platformFetchJson<{ ok?: boolean }>(
        `/api/installer/home-support/homes/${homeId}/rooms`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName, haAreaName }),
        },
        'Failed to add room.'
      );
      setNewRoomDisplayName((prev) => ({ ...prev, [homeId]: '' }));
      await loadRooms(homeId);
    } catch (err) {
      alert(friendlyUnknownError(err, 'Failed to add room.'));
    } finally {
      setAddingRoom((prev) => ({ ...prev, [homeId]: false }));
    }
  }

  async function rekeyRoom(homeId: number, roomId: string) {
    try {
      await platformFetchJson<{ ok?: boolean }>(
        `/api/installer/home-support/homes/${homeId}/rooms/${encodeURIComponent(roomId)}/rekey`,
        { method: 'POST' },
        'Failed to re-key room QR.'
      );
      await loadRooms(homeId);
    } catch (err) {
      alert(friendlyUnknownError(err, 'Failed to re-key room QR.'));
    }
  }

  async function resyncRoom(homeId: number, roomId: string, haAreaName: string) {
    try {
      await platformFetchJson<{ ok?: boolean }>(
        `/api/installer/home-support/homes/${homeId}/rooms/${encodeURIComponent(roomId)}/resync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ haAreaName }),
        },
        'Failed to resync HA area name.'
      );
      await loadRooms(homeId);
    } catch (err) {
      alert(friendlyUnknownError(err, 'Failed to resync HA area name.'));
    }
  }

  async function removeRoom(homeId: number, room: RoomSummary) {
    const ok = window.confirm(
      `Remove "${room.displayName}"? This will also revoke tenant access for HA area "${room.haAreaName}".`
    );
    if (!ok) return;
    try {
      await platformFetchJson<{ ok?: boolean }>(
        `/api/installer/home-support/homes/${homeId}/rooms/${encodeURIComponent(room.id)}`,
        { method: 'DELETE' },
        'Failed to remove room.'
      );
      await loadRooms(homeId);
    } catch (err) {
      alert(friendlyUnknownError(err, 'Failed to remove room.'));
    }
  }

  async function lookupHomes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const homeId = lookupHomeId.trim();
    const serial = lookupSerial.trim();

    if (!homeId && !serial) {
      await loadAllHomes();
      return;
    }
    if (homeId && serial) {
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
    if (next) {
      void loadRooms(next);
      void loadHaAreas(next);
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
            <p className="text-sm text-slate-500">{getCompanyRoleLabel(role)}</p>
            <p className="text-lg font-semibold text-slate-900">{installerName}</p>
          </div>
          <div className="flex gap-2">
            {canAccessProvision(role) ? (
              <Link
                href="/installer/provision"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Provision hubs
              </Link>
            ) : null}
            {canAccessGdpr(role) ? (
              <Link
                href="/installer/GDPR_Status"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                GDPR Status
              </Link>
            ) : null}
            <Link
              href="/companylogin/login"
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
              <p className="text-sm text-slate-600">
                Staff-only hub for support requests, evidence ownership, audit follow-up, and approved impersonation.
              </p>
            </div>
          </div>

          {canSeeAuditSection ? (
            <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Audit and support</p>
              <p className="mt-2 text-sm text-slate-600">
                Use this page as the Dinodia staff one-stop entry point for audit evidence, supplier follow-up, incident
                handling, and customer support access controls.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operating model</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    <li>Keep audit requests, support access requests, and supplier follow-up in one place.</li>
                    <li>Record ticket IDs, approver, owner, and due date before closing any support task.</li>
                    <li>Do not store customer PII here; use the linked evidence pages for formal records.</li>
                  </ul>
                </div>

                {canSeeAuditQuickLinks ? (
                  <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick links</p>
                    <div className="mt-2 space-y-2">
                      {supportHubLinks.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href as Route}
                          className="block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          <div>{item.label}</div>
                          <div className="text-xs font-normal text-slate-500">{item.note}</div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick links</p>
                    <p className="mt-2 text-sm text-slate-600">
                      Audit runbooks are managed by CXO. Use the support workflows below.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {supportHubMatrix.map((item) => (
                  <div key={item.title} className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-2 text-sm text-slate-600">{item.body}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

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
                Search / refresh
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Leave both fields blank to list homes. Enter Home ID or Hub Serial to filter.
            </p>
          </form>

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

                          <section className="rounded-md bg-white p-3 shadow-inner ring-1 ring-slate-200">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">Rooms / Areas</p>
                              <button
                                onClick={() => loadRooms(home.homeId)}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                Refresh
                              </button>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                              Manage persistent room QR codes for this hub. Removing a room also revokes tenant access for that HA area.
                            </p>

                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                              <div>
                                <label className="block text-xs font-semibold text-slate-700">Room display name</label>
                                <input
                                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                                  value={newRoomDisplayName[home.homeId] ?? ''}
                                  onChange={(e) =>
                                    setNewRoomDisplayName((prev) => ({ ...prev, [home.homeId]: e.target.value }))
                                  }
                                  placeholder="e.g. Room 1"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-slate-700">Home Assistant area</label>
                                {Array.isArray(haAreasByHomeId[home.homeId]) && haAreasByHomeId[home.homeId]!.length > 0 ? (
                                  <select
                                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                                    value={newRoomHaAreaName[home.homeId] ?? ''}
                                    onChange={(e) =>
                                      setNewRoomHaAreaName((prev) => ({ ...prev, [home.homeId]: e.target.value }))
                                    }
                                  >
                                    {haAreasByHomeId[home.homeId]!.map((area) => (
                                      <option key={area} value={area}>
                                        {area}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                                    value={newRoomHaAreaName[home.homeId] ?? ''}
                                    onChange={(e) =>
                                      setNewRoomHaAreaName((prev) => ({ ...prev, [home.homeId]: e.target.value }))
                                    }
                                    placeholder="e.g. Bedroom"
                                  />
                                )}
                              </div>
                              <div className="flex items-end">
                                <button
                                  onClick={() => addRoom(home.homeId)}
                                  disabled={Boolean(addingRoom[home.homeId])}
                                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                >
                                  {addingRoom[home.homeId] ? 'Adding…' : 'Add room'}
                                </button>
                              </div>
                            </div>

                            {roomsError[home.homeId] ? (
                              <p className="mt-2 text-xs text-rose-600">{roomsError[home.homeId]}</p>
                            ) : null}
                            {roomsLoading[home.homeId] ? (
                              <p className="mt-2 text-xs text-slate-600">Loading rooms…</p>
                            ) : null}

                            {(roomsByHomeId[home.homeId] ?? []).length === 0 && !roomsLoading[home.homeId] ? (
                              <p className="mt-2 text-xs text-slate-600">No rooms created yet.</p>
                            ) : null}

                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              {(roomsByHomeId[home.homeId] ?? []).map((room) => {
                                const areas = haAreasByHomeId[home.homeId] ?? [];
                                const selectOptions = areas.length ? areas : [room.haAreaName];
                                return (
                                  <div key={room.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-900">{room.displayName}</p>
                                        <p className="mt-1 text-[11px] text-slate-600">
                                          HA area: <span className="font-medium">{room.haAreaName}</span>
                                        </p>
                                        <p className="mt-1 text-[11px] text-slate-500">
                                          Original: {room.haAreaNameOriginal} • Key v{room.qrKeyVersion}
                                        </p>
                                      </div>
                                      {room.qrDataUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={room.qrDataUrl}
                                          alt={`${room.displayName} QR`}
                                          className="h-24 w-24 rounded-lg border border-slate-200 bg-white"
                                        />
                                      ) : null}
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => rekeyRoom(home.homeId, room.id)}
                                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                      >
                                        Re-key QR
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeRoom(home.homeId, room)}
                                        className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                                      >
                                        Remove room
                                      </button>
                                    </div>

                                    <div className="mt-3">
                                      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        Resync HA area
                                      </label>
                                      <select
                                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                                        defaultValue={room.haAreaName}
                                        onChange={(e) => resyncRoom(home.homeId, room.id, e.target.value)}
                                      >
                                        {selectOptions.map((area) => (
                                          <option key={area} value={area}>
                                            {area}
                                          </option>
                                        ))}
                                      </select>
                                      <p className="mt-1 text-[11px] text-slate-500">
                                        Resync updates tenant access rules to match the new HA area name. Original name is preserved.
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
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
                {hasSearched ? 'No homes found.' : 'Loading homes…'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
