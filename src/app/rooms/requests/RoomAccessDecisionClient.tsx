'use client';

import { useCallback, useMemo, useState } from 'react';

type DecisionKind = 'approve' | 'reject';

export function RoomAccessDecisionClient({ kind, token }: { kind: DecisionKind; token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = kind === 'reject' ? 'Reject request' : 'Approve request';
  const buttonClass = useMemo(() => {
    const base =
      'mt-6 w-full rounded-2xl px-4 py-3 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60';
    return kind === 'reject'
      ? `${base} bg-rose-600 text-white hover:bg-rose-700`
      : `${base} bg-indigo-600 text-white hover:bg-indigo-700`;
  }, [kind]);

  const onSubmit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/rooms/requests/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = (await res.json().catch(() => null)) as { ok?: boolean; status?: string } | null;
      const status = data?.status ?? 'ERROR';
      window.location.assign(`/rooms/requests/result?status=${encodeURIComponent(status)}`);
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }, [kind, token]);

  return (
    <div>
      <button className={buttonClass} disabled={loading} onClick={() => void onSubmit()}>
        {loading ? 'Working…' : label}
      </button>
      {error ? <p className="mt-3 text-center text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

