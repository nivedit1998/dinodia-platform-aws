import { NewDeviceCommissioningSession } from '@prisma/client';
import { applyHaLabel } from '@/lib/haLabels';
import {
  diffRegistrySnapshots,
  fetchRegistrySnapshot,
  RegistrySnapshot,
} from '@/lib/haRegistrySnapshot';
import type { HaConnectionLike } from '@/lib/homeAssistant';
import { fetchHaState } from '@/lib/homeAssistant';
import { getSessionSnapshots } from '@/lib/matterSessions';
import { prisma } from '@/lib/prisma';
import { assignHaAreaToDevices } from '@/lib/haAreas';

async function resolveFriendlyName(
  ha: HaConnectionLike,
  entityId: string,
  requestedName?: string | null
) {
  if (requestedName && requestedName.trim().length > 0) return requestedName.trim();
  try {
    const state = await fetchHaState(ha, entityId);
    const friendly = state?.attributes?.friendly_name;
    if (typeof friendly === 'string' && friendly.trim().length > 0) {
      return friendly.trim();
    }
  } catch (err) {
    console.warn('[commissioning workflow] Failed to read HA state for name', { entityId, err });
  }
  return entityId;
}

async function upsertDeviceOverrides(
  session: NewDeviceCommissioningSession,
  ha: HaConnectionLike,
  entityIds: string[]
) {
  if (entityIds.length === 0) return;
  const requestedArea = session.requestedArea;
  const requestedDinodiaType = session.requestedDinodiaType;
  const requestedName = session.requestedName;
  const haConnectionId = session.haConnectionId;

  const names = await Promise.all(
    entityIds.map((entityId) => resolveFriendlyName(ha, entityId, requestedName))
  );

  await Promise.all(
    entityIds.map((entityId, idx) =>
      prisma.device.upsert({
        where: {
          haConnectionId_entityId: {
            haConnectionId,
            entityId,
          },
        },
        update: {
          area: requestedArea,
          ...(requestedDinodiaType ? { label: requestedDinodiaType } : {}),
          ...(requestedName ? { name: requestedName } : {}),
        },
        create: {
          haConnectionId,
          entityId,
          name: names[idx] ?? entityId,
          area: requestedArea,
          label: requestedDinodiaType ?? null,
        },
      })
    )
  );
}

export async function finalizeCommissioningSuccess(
  session: NewDeviceCommissioningSession,
  ha: HaConnectionLike,
  opts?: { beforeSnapshot?: RegistrySnapshot | null }
) {
  const { before } = getSessionSnapshots(session);
  const baseline = opts?.beforeSnapshot ?? before;
  const afterSnapshot = await fetchRegistrySnapshot(ha);
  const { newDeviceIds, newEntityIds } = diffRegistrySnapshots(baseline, afterSnapshot);

  await prisma.newDeviceCommissioningSession.update({
    where: { id: session.id },
    data: {
      afterDeviceIds: afterSnapshot.deviceIds,
      afterEntityIds: afterSnapshot.entityIds,
    },
  });

  await upsertDeviceOverrides(session, ha, newEntityIds);

  let labelWarning: string | undefined;
  if (session.requestedHaLabelId) {
    const result = await applyHaLabel(ha, session.requestedHaLabelId, {
      deviceIds: newDeviceIds,
      entityIds: newEntityIds,
    });
    if (!result.ok && result.warning) {
      labelWarning = result.warning;
    }
  }

  let areaWarning: string | undefined;
  if (session.requestedArea) {
    const result = await assignHaAreaToDevices(ha, session.requestedArea, newDeviceIds);
    if (!result.ok && result.warning) {
      areaWarning = result.warning;
    }
  }

  return { newDeviceIds, newEntityIds, labelWarning, areaWarning };
}
