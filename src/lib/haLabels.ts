import { HaWsClient } from '@/lib/haWebSocket';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { hashForLog, safeLog } from '@/lib/safeLogger';

export type HaLabel = {
  label_id: string;
  name: string;
};

type HaDeviceRegistryEntry = {
  id?: string;
  labels?: string[] | null;
};

type HaEntityRegistryEntry = {
  entity_id?: string;
  labels?: string[] | null;
};

function normalizeLabels(labels: string[] | null | undefined) {
  return Array.from(
    new Set(
      (labels ?? [])
        .filter((lbl) => typeof lbl === 'string')
        .map((lbl) => lbl.trim())
        .filter(Boolean)
    )
  );
}

export async function listHaLabels(ha: HaConnectionLike): Promise<HaLabel[]> {
  const client = await HaWsClient.connect(ha);
  try {
    const labels = await client.call<HaLabel[]>('config/label_registry/list');
    return (labels ?? [])
      .filter((label) => typeof label?.label_id === 'string')
      .map((label) => ({
        label_id: label.label_id,
        name: typeof label?.name === 'string' && label.name.trim().length > 0 ? label.name : label.label_id,
      }));
  } finally {
    client.close();
  }
}

async function applyLabelToDevices(
  client: HaWsClient,
  labelId: string,
  devices: HaDeviceRegistryEntry[],
  targetDeviceIds: string[]
) {
  const targetSet = new Set(targetDeviceIds.map((id) => id.trim()).filter(Boolean));
  for (const device of devices) {
    const id = typeof device.id === 'string' ? device.id.trim() : '';
    if (!id || !targetSet.has(id)) continue;
    const labels = normalizeLabels(device.labels);
    if (labels.includes(labelId)) continue;
    labels.push(labelId);
    await client.call('config/device_registry/update', {
      device_id: id,
      labels,
    });
  }
}

async function applyLabelToEntities(
  client: HaWsClient,
  labelId: string,
  entities: HaEntityRegistryEntry[],
  targetEntityIds: string[]
) {
  const targetSet = new Set(targetEntityIds.map((id) => id.trim()).filter(Boolean));
  for (const entity of entities) {
    const id = typeof entity.entity_id === 'string' ? entity.entity_id.trim() : '';
    if (!id || !targetSet.has(id)) continue;
    const labels = normalizeLabels(entity.labels);
    if (labels.includes(labelId)) continue;
    labels.push(labelId);
    await client.call('config/entity_registry/update', {
      entity_id: id,
      labels,
    });
  }
}

export async function applyHaLabel(
  ha: HaConnectionLike,
  labelId: string,
  targets: { deviceIds?: string[]; entityIds?: string[] }
): Promise<{ ok: boolean; warning?: string }> {
  const client = await HaWsClient.connect(ha);
  try {
    const [devices, entities] = await Promise.all([
      client.call<HaDeviceRegistryEntry[]>('config/device_registry/list'),
      client.call<HaEntityRegistryEntry[]>('config/entity_registry/list'),
    ]);

    await applyLabelToDevices(client, labelId, devices ?? [], targets.deviceIds ?? []);
    await applyLabelToEntities(client, labelId, entities ?? [], targets.entityIds ?? []);
    return { ok: true };
  } catch (err) {
    const warning =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to apply HA label to new device/entities';
    safeLog('warn', '[haLabels] Failed to apply label', {
      labelIdHash: hashForLog(labelId),
      err,
    });
    return { ok: false, warning };
  } finally {
    client.close();
  }
}
