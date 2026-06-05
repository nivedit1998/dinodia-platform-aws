'use client';

import { RemoteDeviceSummary } from '@/types/remote';

type RemoteTileProps = {
  remote: RemoteDeviceSummary;
  onOpenDetails: () => void;
};

export function RemoteTile({ remote, onOpenDetails }: RemoteTileProps) {
  const targetName = remote.target?.name?.trim() || 'No target assigned';
  const targetKind = remote.capability?.targetKind?.trim() || remote.target?.domain?.trim() || 'device';
  const area = (remote.areaName ?? remote.area ?? 'Unassigned').trim() || 'Unassigned';
  const stateText =
    remote.binding?.enabled === false
      ? 'Disabled'
      : remote.binding
        ? remote.resolutionState === 'target_unresolved'
          ? 'Bound • target unresolved'
          : 'Bound'
        : 'Unbound';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      className="relative w-full max-w-[360px] select-none rounded-[26px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-[0_18px_40px_rgba(16,22,42,0.10)] transition duration-300 hover:-translate-y-0.5 active:translate-y-0 sm:max-w-none sm:p-6"
    >
      <div className="absolute right-4 top-4">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
          Remote
        </span>
      </div>
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="space-y-2 pr-16">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Remote controls</p>
          <p className="text-lg font-semibold text-slate-900">{remote.name}</p>
          <p className="text-sm text-slate-600">
            {targetName === 'No target assigned' ? targetName : `Controls ${targetName}`}
          </p>
          <p className="text-xs text-slate-500">
            {targetKind !== 'device' ? `${targetKind} • ` : ''}
            {stateText}
          </p>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
            <p className="text-[10px]">Area</p>
            <p className="mt-1 text-sm font-medium normal-case tracking-normal text-slate-600">
              {area}
            </p>
          </div>
          <button
            type="button"
            aria-label="Open remote details"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetails();
            }}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            Details
          </button>
        </div>
      </div>
    </div>
  );
}
