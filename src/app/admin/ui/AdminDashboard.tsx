'use client';

import { useEffect, useState } from 'react';

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

type EditValues = {
  [entityId: string]: {
    name: string;
    area: string;
    label: string;
  };
};

export default function AdminDashboard({ username }: Props) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editValues, setEditValues] = useState<EditValues>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Tenant creation
  const [tenantForm, setTenantForm] = useState({
    username: '',
    password: '',
    area: '',
  });
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);

  async function loadDevices() {
    setLoadingDevices(true);
    setError(null);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      setLoadingDevices(false);

      if (!res.ok) {
        setError(data.error || 'Failed to load devices');
        return;
      }

      const list: Device[] = data.devices || [];
      setDevices(list);

      // Initialize edit values with existing data
      const next: EditValues = {};
      for (const d of list) {
        next[d.entityId] = {
          name: d.name,
          area: d.area ?? '',
          label: d.label ?? '',
        };
      }
      setEditValues(next);
    } catch (e) {
      console.error(e);
      setLoadingDevices(false);
      setError('Failed to load devices');
    }
  }

  // Poll every 3 seconds
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

  function updateEditValue(
    entityId: string,
    field: 'name' | 'area' | 'label',
    value: string
  ) {
    setEditValues((prev) => ({
      ...prev,
      [entityId]: {
        ...(prev[entityId] || { name: '', area: '', label: '' }),
        [field]: value,
      },
    }));
  }

  async function saveDevice(entityId: string) {
    const current = editValues[entityId];
    if (!current) return;

    setSaveMessage(null);

    const res = await fetch('/api/admin/device', {
      method: 'POST',
      body: JSON.stringify({
        entityId,
        name: current.name,
        area: current.area,
        label: current.label,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      setSaveMessage(data.error || 'Failed to save device');
    } else {
      setSaveMessage('Device settings saved ✅');
      // Optionally refresh devices to reflect latest DB
      loadDevices();
    }
  }

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    setTenantMsg(null);

    const res = await fetch('/api/admin/tenant', {
      method: 'POST',
      body: JSON.stringify(tenantForm),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      setTenantMsg(data.error || 'Failed to create tenant');
    } else {
      setTenantMsg('Tenant created successfully ✅');
      setTenantForm({ username: '', password: '', area: '' });
    }
  }

  return (
    <div className="w-full max-w-5xl bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">Dinodia Admin</h1>
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
            <h2 className="text-sm font-semibold">All devices (from HA)</h2>
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

          {saveMessage && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {saveMessage}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {devices.map((d) => {
              const edit = editValues[d.entityId] || {
                name: d.name,
                area: d.area ?? '',
                label: d.label ?? '',
              };

              return (
                <div
                  key={d.entityId}
                  className="border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-2"
                >
                  <div>
                    <label className="block text-[11px] mb-1">Name</label>
                    <input
                      className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
                      value={edit.name}
                      onChange={(e) =>
                        updateEditValue(d.entityId, 'name', e.target.value)
                      }
                    />
                  </div>

                  <div className="text-slate-500 break-all text-[11px]">
                    {d.entityId}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] mb-1">Area</label>
                      <input
                        placeholder="Room 1, Kitchen..."
                        className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
                        value={edit.area}
                        onChange={(e) =>
                          updateEditValue(d.entityId, 'area', e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-1">Label</label>
                      <input
                        placeholder="Light, Blind, TV..."
                        className="w-full border rounded-md px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
                        value={edit.label}
                        onChange={(e) =>
                          updateEditValue(d.entityId, 'label', e.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-1 text-[11px]">
                    State:{' '}
                    <span className="font-semibold">
                      {d.state}
                    </span>
                  </div>

                  <button
                    onClick={() => saveDevice(d.entityId)}
                    className="mt-2 w-full text-[11px] bg-indigo-600 text-white rounded-md py-1 font-medium hover:bg-indigo-700"
                  >
                    Save
                  </button>
                </div>
              );
            })}
            {devices.length === 0 && !loadingDevices && (
              <p className="text-xs text-slate-500">
                No devices found yet. Make sure HA URL and token are correct.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          {/* Profile stub – can wire later */}
          <div>
            <h2 className="font-semibold mb-3">Profile (coming next)</h2>
            <p className="text-xs text-slate-500">
              Here you&apos;ll be able to change your portal password and Home
              Assistant details.
            </p>
          </div>

          {/* Home Setup – create tenants (area-only) */}
          <div>
            <h2 className="font-semibold mb-3">Home setup – add tenant</h2>
            <form onSubmit={createTenant} className="space-y-3">
              <div>
                <label className="block mb-1 text-xs">Tenant Username</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={tenantForm.username}
                  onChange={(e) =>
                    setTenantForm((f) => ({ ...f, username: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block mb-1 text-xs">Tenant Password</label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={tenantForm.password}
                  onChange={(e) =>
                    setTenantForm((f) => ({ ...f, password: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block mb-1 text-xs">Associated Area</label>
                <input
                  placeholder="Room 1, Kitchen..."
                  className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  value={tenantForm.area}
                  onChange={(e) =>
                    setTenantForm((f) => ({ ...f, area: e.target.value }))
                  }
                />
              </div>
              <button
                type="submit"
                className="mt-1 bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700"
              >
                Add Tenant
              </button>
            </form>
            {tenantMsg && (
              <p className="mt-2 text-xs text-slate-600">{tenantMsg}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
