import { NextRequest, NextResponse } from 'next/server';
import { CommissioningKind, MatterCommissioningStatus, Prisma, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { resolveHaCloudFirst } from '@/lib/haConnection';
import { continueConfigFlow, abortConfigFlow } from '@/lib/haConfigFlow';
import {
  deriveStatusFromFlowStep,
  findSessionForUser,
  getSessionSnapshots,
  shapeSessionResponse,
} from '@/lib/matterSessions';
import { prisma } from '@/lib/prisma';
import { fetchRegistrySnapshot } from '@/lib/haRegistrySnapshot';
import { finalizeCommissioningSuccess } from '@/lib/deviceCommissioningWorkflow';
import { isSafeDiscoverySchema, sanitizeHaStep } from '@/lib/haDiscovery';

type Body = {
  userInput?: Record<string, unknown>;
};

function sanitizeUserInput(raw: Body | unknown): Record<string, unknown> {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? ((raw as Body).userInput ?? raw)
      : {};
  if (!obj || typeof obj !== 'object') return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof key !== 'string') continue;
    if (typeof value === 'string') {
      result[key] = value.trim();
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (value === null) {
      result[key] = null;
    }
  }
  return result;
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

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params;
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.TENANT) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing session id' }, { status: 400 });
  }

  let session = await findSessionForUser(sessionId, me.id, { kind: CommissioningKind.DISCOVERY });
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (
    session.status === MatterCommissioningStatus.SUCCEEDED ||
    session.status === MatterCommissioningStatus.FAILED ||
    session.status === MatterCommissioningStatus.CANCELED
  ) {
    return NextResponse.json(
      { error: 'This setup session is already finished.', session: shapeSessionResponse(session) },
      { status: 400 }
    );
  }

  const haConnection = await prisma.haConnection.findUnique({
    where: { id: session.haConnectionId },
    select: { baseUrl: true, cloudUrl: true, longLivedToken: true },
  });
  if (!haConnection) {
    return NextResponse.json(
      { error: 'Dinodia Hub connection is no longer available for this session.' },
      { status: 400 }
    );
  }
  const ha = resolveHaCloudFirst(haConnection);

  let { before } = getSessionSnapshots(session);
  if (!before) {
    try {
      before = await fetchRegistrySnapshot(ha);
      session = await prisma.newDeviceCommissioningSession.update({
        where: { id: session.id },
        data: {
          beforeDeviceIds: before.deviceIds,
          beforeEntityIds: before.entityIds,
        },
      });
    } catch (err) {
      console.error('[api/tenant/discovery/sessions/step] Failed to capture fallback snapshot', err);
    }
  }

  const userInput = sanitizeUserInput(await req.json().catch(() => ({})));
  const lastHaStep = session.lastHaStep as { flow_id?: string } | null;
  const flowId = session.haFlowId ?? lastHaStep?.flow_id ?? null;
  if (!flowId) {
    return NextResponse.json(
      { error: 'The discovery flow is not available. Please start a new session.' },
      { status: 400 }
    );
  }

  let haStep;
  try {
    haStep = sanitizeHaStep(await continueConfigFlow(ha, flowId, userInput));
  } catch (err) {
    console.error('[api/tenant/discovery/sessions/step] Failed to continue HA flow', err);
    return NextResponse.json(
      { error: 'Home Assistant did not accept the details. Please try again.' },
      { status: 502 }
    );
  }

  if (haStep.type === 'form' && !isSafeDiscoverySchema(haStep.data_schema)) {
    await abortConfigFlow(ha, haStep.flow_id ?? flowId);
    session = await prisma.newDeviceCommissioningSession.update({
      where: { id: session.id },
      data: {
        status: MatterCommissioningStatus.FAILED,
        lastHaStep: haStep as Prisma.InputJsonValue,
        error: 'This device requires setup in Home Assistant. Please finish it there.',
      },
    });
    return NextResponse.json(
      { error: 'This device requires setup in Home Assistant. Please finish it there.', session: shapeSessionResponse(session) },
      { status: 400 }
    );
  }

  const status = deriveStatusFromFlowStep(haStep);
  const updateData: Prisma.NewDeviceCommissioningSessionUpdateInput = {
    status,
    haFlowId: haStep.flow_id ?? session.haFlowId,
    lastHaStep: haStep as Prisma.InputJsonValue,
    error: status === MatterCommissioningStatus.FAILED ? deriveErrorMessage(haStep) : null,
  };

  const warnings: string[] = [];

  if (status === MatterCommissioningStatus.SUCCEEDED) {
    const updated = await prisma.newDeviceCommissioningSession.update({
      where: { id: session.id },
      data: updateData,
    });
    const { labelWarning, areaWarning } = await finalizeCommissioningSuccess(updated, ha, {
      beforeSnapshot: before ?? undefined,
    });
    if (labelWarning) warnings.push(labelWarning);
    if (areaWarning) warnings.push(areaWarning);
    session = (await prisma.newDeviceCommissioningSession.findUnique({
      where: { id: session.id },
    }))!;
  } else {
    session = await prisma.newDeviceCommissioningSession.update({
      where: { id: session.id },
      data: updateData,
    });
  }

  return NextResponse.json({
    ok: true,
    session: shapeSessionResponse(session),
    warnings,
  });
}
