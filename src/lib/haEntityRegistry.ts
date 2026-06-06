import { HaWsClient } from '@/lib/haWebSocket';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { hashForLog, safeLog } from '@/lib/safeLogger';

export type HaEntityRegistryEntry = {
  entity_id: string;
  device_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  labels?: string[] | null;
};

export async function getEntityRegistryEntriesForDevices(
  ha: HaConnectionLike,
  deviceIds: string[]
): Promise<HaEntityRegistryEntry[]> {
  const targetSet = new Set(deviceIds.map((id) => id.trim()).filter(Boolean));
  if (targetSet.size === 0) return [];
  const client = await HaWsClient.connect(ha);
  try {
    const entities = await client.call<HaEntityRegistryEntry[]>('config/entity_registry/list');
    return (entities ?? []).filter((entity) => {
      const deviceId = typeof entity.device_id === 'string' ? entity.device_id.trim() : '';
      return deviceId && targetSet.has(deviceId);
    });
  } finally {
    client.close();
  }
}

export async function renameHaEntitiesForTenantDevice(
  ha: HaConnectionLike,
  targets: { deviceIds: string[]; entityIds: string[] },
  haTechnicalName: string
): Promise<{ ok: boolean; warning?: string }> {
  const entityIds = new Set(targets.entityIds.map((id) => id.trim()).filter(Boolean));
  const deviceEntries = await getEntityRegistryEntriesForDevices(ha, targets.deviceIds);
  for (const entry of deviceEntries) {
    if (entry.entity_id) entityIds.add(entry.entity_id);
  }
  if (entityIds.size === 0) return { ok: true };

  const client = await HaWsClient.connect(ha);
  const errors: string[] = [];
  try {
    let index = 0;
    for (const entityId of entityIds) {
      index += 1;
      const domain = entityId.split('.')[0] || '';
      const name = entityIds.size === 1 ? haTechnicalName : `${haTechnicalName}_${index}`;
      const targetEntityId = domain ? `${domain}.${name}` : undefined;
      try {
        await client.call('config/entity_registry/update', {
          entity_id: entityId,
          name,
          ...(targetEntityId ? { new_entity_id: targetEntityId } : {}),
        });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        safeLog('warn', '[haEntityRegistry] Failed tenant entity rename', {
          entityIdHash: hashForLog(entityId),
          err,
        });
      }
    }
  } finally {
    client.close();
  }

  return {
    ok: errors.length === 0,
    warning: errors.length > 0 ? errors.join('; ') : undefined,
  };
}
