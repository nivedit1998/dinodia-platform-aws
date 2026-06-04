import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';

import { requireUserFromRequest } from '@/lib/apiGuards';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { safeLog } from '@/lib/safeLogger';
import { callHaService } from '@/lib/homeAssistant';
import { SERVICE_REGISTER_BINDING } from '@/lib/remoteManager';

function normalize(value: string | null | undefined) {
  return (value ?? '').toString().trim();
}

function buildHaCandidates(haConnection: {
  baseUrl: string;
  cloudUrl: string | null;
  longLivedToken: string;
}) {
  const candidates: Array<{ baseUrl: string; longLivedToken: string }> = [];
  const seen = new Set<string>();
  for (const value of [haConnection.cloudUrl, haConnection.baseUrl]) {
    const normalized = normalize(value).replace(/\/+$/, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ baseUrl: normalized, longLivedToken: haConnection.longLivedToken });
  }
  return candidates;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ remoteDeviceId: string }> }
) {
  let me;
  try {
    me = await requireUserFromRequest(req);
  } catch {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (me.role === Role.ADMIN) {
    return NextResponse.json({ error: 'Admin dashboards are observe-only.' }, { status: 403 });
  }

  const { remoteDeviceId: paramRemoteDeviceId } = await params;
  const remoteDeviceId = normalize(paramRemoteDeviceId);
  if (!remoteDeviceId) {
    return NextResponse.json({ error: 'Remote device is required.' }, { status: 400 });
  }

  let user;
  let haConnection;
  try {
    ({ user, haConnection } = await getUserWithHaConnection(me.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  const payload = await req.json().catch(() => ({}));
  const targetDeviceId = normalize(payload.targetDeviceId ?? payload.target_device_id) || null;
  const targetEntityId = normalize(payload.targetEntityId ?? payload.target_entity_id) || null;
  const bindingName = normalize(payload.bindingName ?? payload.binding_name) || null;

  if (!targetDeviceId && !targetEntityId) {
    return NextResponse.json({ error: 'Choose a target device or entity.' }, { status: 400 });
  }

  const candidates = buildHaCandidates(haConnection);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const result = await callHaService(candidate, 'dinodia_remote_manager', SERVICE_REGISTER_BINDING, {
        remote_device_id: remoteDeviceId,
        target_device_id: targetDeviceId,
        target_entity_id: targetEntityId,
        binding_name: bindingName,
      });
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      lastError = err;
    }
  }

  safeLog('error', '[api/remote-devices/:id] Failed to update remote binding', {
    userId: user.id,
    remoteDeviceId,
    error: lastError,
  });
  return NextResponse.json(
    { error: 'Dinodia Hub did not respond when updating this remote.' },
    { status: 502 }
  );
}
