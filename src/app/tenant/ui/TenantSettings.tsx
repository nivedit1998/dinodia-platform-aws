'use client';

import { useState } from 'react';

type Props = {
  username: string;
};

type StatusMessage = { type: 'success' | 'error'; message: string } | null;

const EMPTY_FORM = {
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

export default function TenantSettings({ username }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [alert, setAlert] = useState<StatusMessage>(null);
  const [loading, setLoading] = useState(false);

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAlert(null);

    if (form.newPassword !== form.confirmNewPassword) {
      setAlert({ type: 'error', message: 'New passwords do not match' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/tenant/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to update password');
      }
      setAlert({ type: 'success', message: 'Password updated successfully' });
      setForm(EMPTY_FORM);
    } catch (err) {
      setAlert({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update password',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">Tenant Settings</h1>
          <p className="text-xs text-slate-500">
            Logged in as <span className="font-medium">{username}</span>
          </p>
        </div>
      </header>

      <section className="text-sm border border-slate-200 rounded-xl p-4">
        <h2 className="font-semibold mb-4">Change password</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block mb-1 text-xs">Current password</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
              value={form.currentPassword}
              onChange={(e) => updateField('currentPassword', e.target.value)}
              required
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block mb-1 text-xs">New password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.newPassword}
                onChange={(e) => updateField('newPassword', e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block mb-1 text-xs">Confirm new password</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.confirmNewPassword}
                onChange={(e) => updateField('confirmNewPassword', e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Minimum 8 characters. Contact your admin if you can&apos;t access your account.
          </p>
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 text-white rounded-lg py-2 px-4 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
        {alert && (
          <p
            className={`mt-2 text-xs ${
              alert.type === 'success' ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {alert.message}
          </p>
        )}
      </section>
    </div>
  );
}
