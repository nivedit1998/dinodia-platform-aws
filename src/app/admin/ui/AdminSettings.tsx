'use client';

import { useState } from 'react';

type Props = {
  username: string;
};

export default function AdminSettings({ username }: Props) {
  const [tenantForm, setTenantForm] = useState({
    username: '',
    password: '',
    area: '',
  });
  const [tenantMsg, setTenantMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateField(key: keyof typeof tenantForm, value: string) {
    setTenantForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTenantMsg(null);
    setLoading(true);

    const res = await fetch('/api/admin/tenant', {
      method: 'POST',
      body: JSON.stringify(tenantForm),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setTenantMsg(data.error || 'Failed to create tenant');
      return;
    }

    setTenantMsg('Tenant created successfully ✅');
    setTenantForm({ username: '', password: '', area: '' });
  }

  async function logout() {
    await fetch('/api/auth/login', { method: 'DELETE' });
    window.location.href = '/login';
  }

  return (
    <div className="w-full max-w-4xl bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b pb-3">
        <div>
          <h1 className="text-2xl font-semibold">Dinodia Admin Settings</h1>
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

      <section className="grid gap-6 md:grid-cols-2 text-sm">
        <div className="border border-slate-200 rounded-xl p-4">
          <h2 className="font-semibold mb-2">Profile</h2>
          <p className="text-xs text-slate-500">
            Portal password and Home Assistant connection updates will be added
            here soon.
          </p>
        </div>

        <div className="border border-slate-200 rounded-xl p-4">
          <h2 className="font-semibold mb-4">Home setup – add tenant</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block mb-1 text-xs">Tenant Username</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={tenantForm.username}
                onChange={(e) => updateField('username', e.target.value)}
              />
            </div>
            <div>
              <label className="block mb-1 text-xs">Tenant Password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={tenantForm.password}
                onChange={(e) => updateField('password', e.target.value)}
              />
            </div>
            <div>
              <label className="block mb-1 text-xs">Associated Area</label>
              <input
                placeholder="Room 1, Kitchen..."
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={tenantForm.area}
                onChange={(e) => updateField('area', e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-1 bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Adding…' : 'Add Tenant'}
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
