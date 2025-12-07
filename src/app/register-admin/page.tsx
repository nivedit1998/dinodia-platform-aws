'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterAdminPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    username: '',
    password: '',
    haUsername: '',
    haPassword: '',
    haBaseUrl: 'http://homeassistant.local:8123/',
    haCloudUrl: '',
    haLongLivedToken: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateField(
    key: keyof typeof form,
    value: string
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch('/api/auth/register-admin', {
      method: 'POST',
      body: JSON.stringify(form),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || 'Registration failed');
      return;
    }

    router.push('/admin');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl bg-white shadow-lg rounded-2xl p-8">
        <h1 className="text-2xl font-semibold mb-4 text-center">
          Register Dinodia Admin
        </h1>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">Portal Username</label>
              <input
                className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.username}
                onChange={(e) => updateField('username', e.target.value)}
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Portal Password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs text-slate-500 mb-2">
              Home Assistant connection (Nabu Casa URL or local URL).
            </p>
            <div className="space-y-3">
              <div>
                <label className="block font-medium mb-1">HA Base URL</label>
                <input
                  placeholder="http://homeassistant.local:8123/"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.haBaseUrl}
                  onChange={(e) => updateField('haBaseUrl', e.target.value)}
                />
              </div>
              <div>
                <label className="block font-medium mb-1">
                  HA Cloud URL (optional)
                </label>
                <input
                  placeholder="https://example.ui.nabu.casa/"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.haCloudUrl}
                  onChange={(e) => updateField('haCloudUrl', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium mb-1">HA Username</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.haUsername}
                    onChange={(e) => updateField('haUsername', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">HA Password</label>
                  <input
                    type="password"
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.haPassword}
                    onChange={(e) => updateField('haPassword', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">
                  HA Long-lived Access Token
                </label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.haLongLivedToken}
                  onChange={(e) =>
                    updateField('haLongLivedToken', e.target.value)
                  }
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Creating admin…' : 'Create Admin & Connect HA'}
          </button>
        </form>
      </div>
    </div>
  );
}
