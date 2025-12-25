import { NextRequest, NextResponse } from 'next/server';
import { CommissioningKind, MatterCommissioningStatus, Prisma, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { fetchRegistrySnapshot } from '@/lib/haRegistrySnapshot';
import { prisma } from '@/lib/prisma';
import { deriveStatusFromFlowStep, hashCommissioningSecret, shapeSessionResponse } from '@/lib/matterSessions';
import { startMatterConfigFlow } from '@/lib/matterConfigFlow';
import { finalizeCommissioningSuccess } from './workflow';
import { CAPABILITIES } from '@/lib/deviceCapabilities';

function isValidDinodiaType(value: string | null | undefined) {
  if (!value) return true;
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, value);
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  const requestedArea =
    typeof body?.requestedArea === 'string' ? body.requestedArea.trim() : '';
  const requestedName =
    typeof body?.requestedName === 'string' ? body.requestedName.trim() : null;
  const requestedDinodiaType =
    typeof body?.requestedDinodiaType === 'string'
      ? body.requestedDinodiaType.trim()
      : null;
  const requestedHaLabelId =
    typeof body?.requestedHaLabelId === 'string'
      ? body.requestedHaLabelId.trim()
      : null;
  const setupPayload =
    typeof body?.setupPayload === 'string' ? body.setupPayload.trim() : null;
  const manualPairingCode =
    typeof body?.manualPairingCode === 'string' ? body.manualPairingCode.trim() : null;

  if (!requestedArea) {
    return NextResponse.json({ error: 'Please choose an area.' }, { status: 400 });
  }
  if (!isValidDinodiaType(requestedDinodiaType)) {
    return NextResponse.json({ error: 'Invalid device type override.' }, { status: 400 });
  }

  let user;
  let haConnection;
  try {
    ({ user, haConnection } = await getUserWithHaConnection(me.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Dinodia Hub connection isn't set up yet for this home." },
      { status: 400 }
    );
  }

  const allowedAreas = new Set(user.accessRules.map((r) => r.area));
  if (!allowedAreas.has(requestedArea)) {
    return NextResponse.json({ error: 'You are not allowed to add devices to that area.' }, { status: 403 });
  }

  const ha = resolveHaCloudFirst(haConnection);
  let beforeSnapshot;
  try {
    beforeSnapshot = await fetchRegistrySnapshot(ha);
  } catch (err) {
    console.error('[api/tenant/matter/sessions] Failed to capture registry snapshot', err);
    return NextResponse.json(
      { error: 'We could not reach your Dinodia Hub to start commissioning. Please try again.' },
      { status: 502 }
    );
  }

  let haStep;
  try {
    haStep = await startMatterConfigFlow(ha);
  } catch (err) {
    console.error('[api/tenant/matter/sessions] Failed to start HA flow', err);
    return NextResponse.json(
      { error: 'Home Assistant did not accept the commissioning request. Please try again.' },
      { status: 502 }
    );
  }

  const status = deriveStatusFromFlowStep(haStep);
  const setupPayloadHash = hashCommissioningSecret(setupPayload);
  const manualPairingCodeHash = hashCommissioningSecret(manualPairingCode);

  let session = await prisma.newDeviceCommissioningSession.create({
    data: {
      userId: user.id,
      haConnectionId: haConnection.id,
      requestedArea,
      requestedName,
      requestedDinodiaType,
      requestedHaLabelId,
      setupPayloadHash,
      manualPairingCodeHash,
      haFlowId: haStep.flow_id ?? null,
      status,
      kind: CommissioningKind.MATTER,
      lastHaStep: haStep as Prisma.InputJsonValue,
      beforeDeviceIds: beforeSnapshot.deviceIds,
      beforeEntityIds: beforeSnapshot.entityIds,
      error: status === MatterCommissioningStatus.FAILED ? 'Home Assistant aborted the commissioning flow.' : null,
    },
  });

  const warnings: string[] = [];

  if (status === MatterCommissioningStatus.SUCCEEDED) {
    const { labelWarning, areaWarning } = await finalizeCommissioningSuccess(session, ha, {
      beforeSnapshot,
    });
    if (labelWarning) warnings.push(labelWarning);
    if (areaWarning) warnings.push(areaWarning);
    session = (await prisma.newDeviceCommissioningSession.findUnique({
      where: { id: session.id },
    }))!;
  }

  return NextResponse.json({
    ok: true,
    session: shapeSessionResponse(session),
    warnings,
  });
}
