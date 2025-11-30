'use client';

import { useEffect, useMemo, useState } from 'react';

type Device = {
  entityId: string;
  name: string;
  state: string;
  area: string | null;
  label: string | null;
};

type Props = {
  username: string;
};

type Tab = 'dashboard' | 'settings';

export default function TenantDashboard({ username }: Props) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDevices() {
    setLoadingDevices(true);
    setError(null);
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      setLoadingDevices(false);

      if (!res.ok) {
        setError(data.error || 'Failed to load devices');
        return;
      }
      setDevices(data.devices || []);
    } catch (e) {
      console.error(e);
      setLoadingDevices(false);
      setError('Failed to load devices');
    }
  }

  useEffect(() => {
    loadDevices();
    const id = setInterval(loadDevices, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await fetch('/api/auth/login', { method: 'DELETE' });
    window.location.href = '/login';
  }

  // Group by label so tiles are separated by Light / Blind / etc
  const groupedByLabel = useMemo(() => {
    const groups: Record<string, Device[]> = {};
    for (const d of devices) {
      const key = d.label || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(d);
    }
    return groups;
  }, [devices]);

  return (
    <div className="w-full max-w-4xl bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">Dinodia Dashboard</h1>
          <p className="text-xs text-slate-500">
            Logged in as <span className="font-medium">{username}</span>
          </p>
        </div>
        <button
          onClick={logout}
          className="text-xs px-3 py-1.5 rounded-lg border text-slate-700 hover:bg-slate-50"
        >
          Logout
        </button>
      </header>

      <nav className="flex gap-2 text-sm">
        <button
          onClick={() => setTab('dashboard')}
          className={`px-3 py-1.5 rounded-lg border ${
            tab === 'dashboard'
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`px-3 py-1.5 rounded-lg border ${
            tab === 'settings'
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Settings
        </button>
      </nav>

      {tab === 'dashboard' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Your devices</h2>
            <button
              onClick={loadDevices}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
            >
              Scan for devices
            </button>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {Object.entries(groupedByLabel).map(([label, group]) => (
              <div key={label} className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-700">
                  {label}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {group.map((d) => (
                    <button
                      key={d.entityId}
                      className="border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-1 hover:border-indigo-400 hover:shadow-sm transition"
                    >
                      <div className="font-medium">{d.name}</div>
                      <div className="text-[11px] text-slate-500">
                        Area: {d.area || '-'}
                      </div>
                      <div className="mt-1 text-[11px]">
                        State:{' '}
                        <span className="font-semibold">
                          {d.state}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {devices.length === 0 && !loadingDevices && (
              <p className="text-xs text-slate-500">
                No devices visible. Ask your Dinodia admin to check your area
                access.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Profile</h2>
          <p className="text-xs text-slate-500">
            Here you’ll be able to change your password (to be implemented
            next). For now, contact your admin to update your login.
          </p>
        </div>
      )}
    </div>
  );
}
