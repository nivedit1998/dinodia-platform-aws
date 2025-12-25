import { NextRequest, NextResponse } from 'next/server';
import { CommissioningKind, MatterCommissioningStatus, Prisma, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { resolveHaCloudFirst } from '@/lib/haConnection';
import { continueMatterConfigFlow, HaConfigFlowStep } from '@/lib/matterConfigFlow';
import {
  deriveStatusFromFlowStep,
  findSessionForUser,
  getSessionSnapshots,
  hashCommissioningSecret,
  shapeSessionResponse,
} from '@/lib/matterSessions';
import { prisma } from '@/lib/prisma';
import { finalizeCommissioningSuccess } from '../../workflow';
import { fetchRegistrySnapshot } from '@/lib/haRegistrySnapshot';

type StepBody = {
  setupPayload?: string | null;
  manualPairingCode?: string | null;
  wifiSsid?: string | null;
  wifiPassword?: string | null;
};

function sanitizeInput(body: unknown): StepBody {
  const obj = (body ?? {}) as Record<string, unknown>;
  const coerce = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  return {
    setupPayload: coerce(obj.setupPayload),
    manualPairingCode: coerce(obj.manualPairingCode),
    wifiSsid: coerce(obj.wifiSsid),
    wifiPassword: coerce(obj.wifiPassword),
  };
}

function buildUserInput(step: HaConfigFlowStep | null, input: StepBody) {
  const userInput: Record<string, unknown> = {};
  const schema = Array.isArray(step?.data_schema) ? step?.data_schema : [];
  const pairingCode = input.setupPayload ?? input.manualPairingCode ?? null;
  const wifiSsid = input.wifiSsid ?? null;
  const wifiPassword = input.wifiPassword ?? null;

  for (const field of schema) {
    const name =
      field && typeof field === 'object' && typeof (field as Record<string, unknown>).name === 'string'
        ? ((field as Record<string, unknown>).name as string)
        : null;
    if (!name) continue;
    const lower = name.toLowerCase();
    if (pairingCode && (lower.includes('code') || lower.includes('pin') || lower.includes('payload'))) {
      userInput[name] = pairingCode;
      continue;
    }
    if (wifiSsid && (lower.includes('ssid') || (lower.includes('network') && lower.includes('name')))) {
      userInput[name] = wifiSsid;
      continue;
    }
    if (
      wifiPassword &&
      (lower.includes('password') || lower.includes('passphrase') || lower.includes('psk'))
    ) {
      userInput[name] = wifiPassword;
    }
  }

  const existingKeys = new Set(Object.keys(userInput).map((k) => k.toLowerCase()));
  if (pairingCode && !Array.from(existingKeys).some((k) => k.includes('code') || k.includes('pin'))) {
    userInput.code = pairingCode;
  }
  if (wifiSsid && !Array.from(existingKeys).some((k) => k.includes('ssid') || k.includes('network'))) {
    userInput.wifi_ssid = wifiSsid;
  }
  if (
    wifiPassword &&
    !Array.from(existingKeys).some(
      (k) => k.includes('password') || k.includes('passphrase') || k.includes('psk')
    )
  ) {
    userInput.wifi_password = wifiPassword;
  }

  return userInput;
}

function deriveErrorMessage(step: HaConfigFlowStep) {
  if (step.type === 'abort') {
    return 'Home Assistant aborted the commissioning flow.';
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

  let session = await findSessionForUser(sessionId, me.id, { kind: CommissioningKind.MATTER });
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (
    session.status === MatterCommissioningStatus.SUCCEEDED ||
    session.status === MatterCommissioningStatus.FAILED ||
    session.status === MatterCommissioningStatus.CANCELED
  ) {
    return NextResponse.json(
      { error: 'This commissioning session is already finished.', session: shapeSessionResponse(session) },
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
      console.error('[api/tenant/matter/sessions/step] Failed to capture fallback snapshot', err);
    }
  }

  const body = sanitizeInput(await req.json().catch(() => ({})));
  if (!body.setupPayload && !body.manualPairingCode && !body.wifiSsid && !body.wifiPassword) {
    return NextResponse.json(
      { error: 'Pairing details are required to continue commissioning.' },
      { status: 400 }
    );
  }
  if ((body.wifiSsid && !body.wifiPassword) || (!body.wifiSsid && body.wifiPassword)) {
    return NextResponse.json(
      { error: 'Please provide both Wi-Fi name and password.' },
      { status: 400 }
    );
  }

  const flowId = session.haFlowId ?? (session.lastHaStep as HaConfigFlowStep | null)?.flow_id ?? null;
  if (!flowId) {
    return NextResponse.json(
      { error: 'The commissioning flow is not available. Please start a new session.' },
      { status: 400 }
    );
  }

  const userInput = buildUserInput(session.lastHaStep as HaConfigFlowStep | null, body);

  let haStep: HaConfigFlowStep;
  try {
    haStep = await continueMatterConfigFlow(ha, flowId, userInput);
  } catch (err) {
    console.error('[api/tenant/matter/sessions/step] Failed to continue HA flow', err);
    return NextResponse.json(
      { error: 'Home Assistant did not accept the commissioning details. Please try again.' },
      { status: 502 }
    );
  }

  const status = deriveStatusFromFlowStep(haStep);
  const setupPayloadHash = hashCommissioningSecret(body.setupPayload) ?? session.setupPayloadHash;
  const manualPairingCodeHash =
    hashCommissioningSecret(body.manualPairingCode) ?? session.manualPairingCodeHash;
  const updateData: Prisma.NewDeviceCommissioningSessionUpdateInput = {
    status,
    haFlowId: haStep.flow_id ?? session.haFlowId,
    lastHaStep: haStep as Prisma.InputJsonValue,
    setupPayloadHash,
    manualPairingCodeHash,
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
