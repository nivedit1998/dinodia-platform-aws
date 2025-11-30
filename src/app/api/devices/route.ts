import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';
import {
  EnrichedDevice,
  getDevicesWithMetadata,
} from '@/lib/homeAssistant';
import { classifyDeviceByLabel } from '@/lib/labelCatalog';

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let user = await prisma.user.findUnique({
    where: { id: me.id },
    include: {
      haConnection: true,
      accessRules: true,
    },
  });

  const logUserState = () => {
    console.log('[api/devices] user state', {
      id: user?.id,
      role: user?.role,
      haConnectionId: user?.haConnectionId,
      hasHaConnection: !!user?.haConnection,
    });
  };

  logUserState();

  let haConnection = user?.haConnection || null;

  // If prisma include didn't hydrate relation but we have ID, fetch it
  if (!haConnection && user?.haConnectionId) {
    haConnection = await prisma.haConnection.findUnique({
      where: { id: user.haConnectionId },
    });
  }

  // Ensure tenants have a haConnection (shared with admin). If missing, reuse an existing admin connection.
  if (!haConnection && user && user.role === Role.TENANT) {
    const adminWithConnection = await prisma.user.findFirst({
      where: { role: Role.ADMIN, haConnectionId: { not: null } },
      select: { haConnectionId: true },
    });
    if (adminWithConnection?.haConnectionId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { haConnectionId: adminWithConnection.haConnectionId },
      });
      haConnection = await prisma.haConnection.findUnique({
        where: { id: adminWithConnection.haConnectionId },
      });
      user = await prisma.user.findUnique({
        where: { id: me.id },
        include: { haConnection: true, accessRules: true },
      });
      logUserState();
    }
  }

  if (!user || !haConnection) {
    return NextResponse.json(
      { error: 'HA connection not configured' },
      { status: 400 }
    );
  }

  // Fetch HA devices with area/labels via template helpers
  let enriched: EnrichedDevice[] = [];
  try {
    enriched = await getDevicesWithMetadata(haConnection);
  } catch (err) {
    console.error('Failed to fetch devices from HA:', err);
    return NextResponse.json(
      { error: 'Failed to fetch HA devices' },
      { status: 502 }
    );
  }

  // Load overrides for this HA connection (name/area/label)
  const dbDevices = await prisma.device.findMany({
    where: { haConnectionId: haConnection.id },
  });
  const overrideMap = new Map(dbDevices.map((d) => [d.entityId, d]));

  // Apply overrides and shape response
  const devices = enriched.map((d) => {
    const override = overrideMap.get(d.entityId);
    const name = override?.name ?? d.name;
    const areaName = override?.area ?? d.areaName ?? null;
    const labels = override?.label ? [override.label] : d.labels;
    const labelCategory =
      classifyDeviceByLabel(labels) ?? d.labelCategory ?? null;
    const primaryLabel =
      labels.length > 0 && labels[0] ? String(labels[0]) : null;
    const label =
      override?.label ??
      primaryLabel ??
      labelCategory ??
      null;

    return {
      entityId: d.entityId,
      name,
      state: d.state,
      area: areaName,
      areaName,
      labels,
      label,
      labelCategory,
    };
  });

  // Filter for tenants by allowed areas
  const result =
    user.role === Role.TENANT
      ? devices.filter(
          (d) =>
            d.areaName !== null &&
            user?.accessRules.some((r) => r.area === d.areaName)
        )
      : devices;

  if (process.env.NODE_ENV !== 'production') {
    const interestingLabels = new Set(['Motion Sensor', 'TV', 'Spotify']);
    const sample = result.filter((d) => {
      const labels = Array.isArray(d.labels) ? d.labels : [];
      const candidates = [
        d.label ?? '',
        ...labels,
        d.labelCategory ?? '',
      ].map((lbl) => (lbl ? lbl.toString().trim() : ''));
      return candidates.some((lbl) => interestingLabels.has(lbl));
    });
    if (sample.length > 0) {
      console.log('[api/devices] sample', sample.slice(0, 10));
    }
  }

  return NextResponse.json({ devices: result });
}
