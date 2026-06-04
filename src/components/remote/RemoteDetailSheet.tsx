'use client';

import { useEffect, useMemo, useState } from 'react';

import { UIDevice } from '@/types/device';
import { RemoteDeviceSummary } from '@/types/remote';
import { getPrimaryLabel } from '@/lib/deviceLabels';
import { Modal } from '@/components/ui/Modal';

type RemoteDetailSheetProps = {
  remote: RemoteDeviceSummary;
  targetOptions: UIDevice[];
  onClose: () => void;
  onSaveTarget: (args: { targetEntityId: string }) => Promise<void>;
};

export function RemoteDetailSheet({
  remote,
  targetOptions,
  onClose,
  onSaveTarget,
}: RemoteDetailSheetProps) {
  const [editing, setEditing] = useState(false);
  const [selectedTargetEntityId, setSelectedTargetEntityId] = useState(
    remote.binding?.targetEntityId ?? remote.target?.entityId ?? ''
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setSelectedTargetEntityId(remote.binding?.targetEntityId ?? remote.target?.entityId ?? '');
  }, [remote.remoteDeviceId, remote.binding?.targetEntityId, remote.target?.entityId]);

  const sortedTargets = useMemo(() => {
    return [...targetOptions].sort((left, right) => {
      const leftArea = (left.areaName ?? left.area ?? '').trim();
      const rightArea = (right.areaName ?? right.area ?? '').trim();
      if (leftArea !== rightArea) return leftArea.localeCompare(rightArea);
      const leftLabel = getPrimaryLabel(left);
      const rightLabel = getPrimaryLabel(right);
      if (leftLabel !== rightLabel) return leftLabel.localeCompare(rightLabel);
      return left.name.localeCompare(right.name);
    });
  }, [targetOptions]);

  const currentTarget = remote.target?.name ?? remote.binding?.targetEntityId ?? 'No target assigned';

  return (
    <Modal
      open
      title={remote.name}
      description={`Remote controls • ${currentTarget}`}
      onClose={onClose}
      width="lg"
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-muted">Remote</p>
            <p className="mt-1 text-sm text-foreground/80">
              Area: {remote.areaName ?? remote.area ?? 'Unassigned'}
            </p>
            <p className="mt-1 text-sm text-foreground/80">
              Binding: {remote.binding?.bindingName ?? remote.binding?.bindingId ?? 'Unbound'}
            </p>
            <p className="mt-1 text-sm text-foreground/80">
              Target: {remote.target?.name ?? 'No target assigned'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Change remote target"
            onClick={() => setEditing((prev) => !prev)}
            className="rounded-full border border-border bg-surface px-3 py-2 text-lg text-muted shadow-sm"
          >
            ⋯
          </button>
        </div>

        {editing ? (
          <div className="space-y-4 rounded-2xl border border-border bg-surface-2 p-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Change remote target</p>
              <p className="text-sm text-muted">
                Choose the entity this remote should control. The target must already be supported by
                Dinodia Remote Manager.
              </p>
            </div>
            <label className="block text-sm font-medium text-foreground">
              Target entity
              <select
                className="mt-2 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none"
                value={selectedTargetEntityId}
                onChange={(event) => setSelectedTargetEntityId(event.target.value)}
              >
                <option value="">Select a target</option>
                {sortedTargets.map((target) => {
                  const area = (target.areaName ?? target.area ?? '').trim();
                  const label = getPrimaryLabel(target);
                  const prefix = area ? `${area} • ` : '';
                  return (
                    <option key={target.entityId} value={target.entityId}>
                      {prefix}
                      {target.name} ({label})
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSelectedTargetEntityId(remote.binding?.targetEntityId ?? remote.target?.entityId ?? '');
                }}
                className="rounded-2xl border border-border px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !selectedTargetEntityId}
                onClick={async () => {
                  if (!selectedTargetEntityId) return;
                  setSaving(true);
                  try {
                    await onSaveTarget({ targetEntityId: selectedTargetEntityId });
                    setEditing(false);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-2xl bg-[color:var(--indigo)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-[0.28em] text-muted">Status</p>
          <p className="mt-2 text-sm text-foreground">
            {remote.binding?.enabled === false
              ? 'Binding disabled'
              : remote.target
                ? `Controls ${remote.target.name}`
                : 'No binding configured'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {remote.target?.domain ? `Target domain: ${remote.target.domain}` : 'Target domain unknown'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
