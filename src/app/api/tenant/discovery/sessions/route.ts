import { NextRequest, NextResponse } from 'next/server';
import { CommissioningKind, MatterCommissioningStatus, Prisma, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { fetchRegistrySnapshot } from '@/lib/haRegistrySnapshot';
import { deriveStatusFromFlowStep, shapeSessionResponse } from '@/lib/matterSessions';
import { listAllowedDiscoveryFlows, isSafeDiscoverySchema, sanitizeHaStep } from '@/lib/haDiscovery';
import { continueConfigFlow, abortConfigFlow } from '@/lib/haConfigFlow';
import { prisma } from '@/lib/prisma';
import { finalizeCommissioningSuccess } from '@/lib/deviceCommissioningWorkflow';
import { CAPABILITIES } from '@/lib/deviceCapabilities';

type Body = {
  flowId?: string;
  requestedArea?: string;
  requestedName?: string | null;
  requestedDinodiaType?: string | null;
  requestedHaLabelId?: string | null;
};

function isValidDinodiaType(value: string | null | undefined) {
  if (!value) return true;
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, value);
}

function deriveErrorMessage(step: { type?: string; errors?: Record<string, string> | undefined }) {
  if (step.type === 'abort') {
    return 'Home Assistant aborted the setup.';
  }
  const errors = step.errors ? Object.values(step.errors).filter(Boolean) : [];
  if (errors.length > 0) {
    return errors.join(', ');
  }
  return null;
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const flowId = typeof body?.flowId === 'string' ? body.flowId.trim() : '';
  const requestedArea =
    typeof body?.requestedArea === 'string' ? body.requestedArea.trim() : '';
  const requestedName =
    typeof body?.requestedName === 'string' && body.requestedName.trim().length > 0
      ? body.requestedName.trim()
      : null;
  const requestedDinodiaType =
    typeof body?.requestedDinodiaType === 'string'
      ? body.requestedDinodiaType.trim()
      : null;
  const requestedHaLabelId =
    typeof body?.requestedHaLabelId === 'string' && body.requestedHaLabelId.trim().length > 0
      ? body.requestedHaLabelId.trim()
      : null;

  if (!flowId) {
    return NextResponse.json({ error: 'Missing discovery flow id.' }, { status: 400 });
  }
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
    return NextResponse.json(
      { error: 'You are not allowed to add devices to that area.' },
      { status: 403 }
    );
  }

  const ha = resolveHaCloudFirst(haConnection);

  let allowedFlows;
  try {
    allowedFlows = await listAllowedDiscoveryFlows(ha);
  } catch (err) {
    console.error('[api/tenant/discovery/sessions] Failed to load discovery list', err);
    return NextResponse.json(
      { error: 'We could not read discovered devices from Dinodia Hub. Please try again.' },
      { status: 502 }
    );
  }

  const targetFlow = allowedFlows.find((f) => f.flowId === flowId);
  if (!targetFlow) {
    return NextResponse.json(
      { error: 'This discovered device is no longer available to claim.' },
      { status: 404 }
    );
  }

  let beforeSnapshot;
  try {
    beforeSnapshot = await fetchRegistrySnapshot(ha);
  } catch (err) {
    console.error('[api/tenant/discovery/sessions] Failed to capture registry snapshot', err);
    return NextResponse.json(
      { error: 'We could not reach your Dinodia Hub to start setup. Please try again.' },
      { status: 502 }
    );
  }

  let haStep;
  try {
    haStep = sanitizeHaStep(await continueConfigFlow(ha, flowId));
  } catch (err) {
    console.error('[api/tenant/discovery/sessions] Failed to continue HA flow', err);
    return NextResponse.json(
      { error: 'Home Assistant did not accept the discovery request. Please try again.' },
      { status: 502 }
    );
  }

  if (haStep.type === 'form' && !isSafeDiscoverySchema(haStep.data_schema)) {
    await abortConfigFlow(ha, haStep.flow_id ?? flowId);
    return NextResponse.json(
      { error: 'This device requires setup in Home Assistant. Please complete it there first.' },
      { status: 400 }
    );
  }

  const status = deriveStatusFromFlowStep(haStep);

  let session = await prisma.newDeviceCommissioningSession.create({
    data: {
      userId: user.id,
      haConnectionId: haConnection.id,
      requestedArea,
      requestedName,
      requestedDinodiaType,
      requestedHaLabelId,
      haFlowId: haStep.flow_id ?? flowId,
      status,
      kind: CommissioningKind.DISCOVERY,
      lastHaStep: haStep as Prisma.InputJsonValue,
      beforeDeviceIds: beforeSnapshot.deviceIds,
      beforeEntityIds: beforeSnapshot.entityIds,
      error: status === MatterCommissioningStatus.FAILED ? deriveErrorMessage(haStep) : null,
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
    flow: targetFlow,
  });
}
