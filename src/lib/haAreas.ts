import { HaWsClient } from '@/lib/haWebSocket';
import type { HaConnectionLike } from '@/lib/homeAssistant';

type HaAreaEntry = {
  area_id?: string;
  name?: string;
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export async function assignHaAreaToDevices(
  ha: HaConnectionLike,
  areaName: string | null | undefined,
  deviceIds: string[]
): Promise<{ ok: boolean; warning?: string }> {
  const normalizedArea = typeof areaName === 'string' ? areaName.trim() : '';
  const targets = deviceIds.map((id) => id.trim()).filter(Boolean);
  if (!normalizedArea || targets.length === 0) {
    return { ok: true };
  }

  const client = await HaWsClient.connect(ha);
  try {
    const areas = await client.call<HaAreaEntry[]>('config/area_registry/list');
    const match = (areas ?? []).find((entry) => {
      const name = typeof entry.name === 'string' ? entry.name : '';
      return normalize(name) === normalize(normalizedArea);
    });
    if (!match?.area_id) {
      return { ok: false, warning: 'Area not found in Home Assistant.' };
    }

    await Promise.all(
      targets.map((deviceId) =>
        client.call('config/device_registry/update', {
          device_id: deviceId,
          area_id: match.area_id,
        })
      )
    );

    return { ok: true };
  } catch (err) {
    const warning =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to assign the device to the selected area.';
    console.warn('[haAreas] Failed to assign area', { areaName, deviceIds, err });
    return { ok: false, warning };
  } finally {
    client.close();
  }
}
