import { NextRequest, NextResponse } from 'next/server';
import { Prisma, Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getRequiredHomeownerPolicyStatementKeys } from '@/lib/homeownerPolicyStatements';
import { recordHomeownerPolicyAcceptance } from '@/lib/homeownerPolicy';
import { sendHomeownerPolicyAcceptedEmails } from '@/lib/homeownerPolicyNotifications';
import { hashForLog } from '@/lib/safeLogger';
import { getClientIp } from '@/lib/requestInfo';

function maskEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '***';
  return `${trimmed.slice(0, 1)}***${trimmed.slice(at)}`;
}

function normalizeRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ ok: false, error: 'Admin access required.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const signatureName = normalizeRequiredString((body as Record<string, unknown>).signatureName);
  const acceptedStatementsRaw = (body as Record<string, unknown>).acceptedStatements;
  const pendingOnboardingId = normalizeRequiredString((body as Record<string, unknown>).pendingOnboardingId) || null;
  const notificationPreference = normalizeRequiredString((body as Record<string, unknown>).notificationPreference) || null;

  const address = {
    addressLine1: normalizeRequiredString((body as Record<string, unknown>).addressLine1),
    addressLine2: normalizeRequiredString((body as Record<string, unknown>).addressLine2) || null,
    city: normalizeRequiredString((body as Record<string, unknown>).city),
    state: normalizeRequiredString((body as Record<string, unknown>).state) || null,
    postcode: normalizeRequiredString((body as Record<string, unknown>).postcode),
    country: normalizeRequiredString((body as Record<string, unknown>).country),
  };

  if (!signatureName) {
    return NextResponse.json({ ok: false, error: 'Typed full name is required.' }, { status: 400 });
  }

  if (!address.addressLine1 || !address.city || !address.postcode || !address.country) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Address line 1, city, postcode, and country are required.',
      },
      { status: 400 }
    );
  }

  if (!acceptedStatementsRaw || typeof acceptedStatementsRaw !== 'object' || Array.isArray(acceptedStatementsRaw)) {
    return NextResponse.json({ ok: false, error: 'Accepted statements are required.' }, { status: 400 });
  }

  const requiredKeys = getRequiredHomeownerPolicyStatementKeys();
  const acceptedStatements = acceptedStatementsRaw as Record<string, unknown>;
  const missingAccepted = requiredKeys.filter((key) => acceptedStatements[key] !== true);
  if (missingAccepted.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'All required statements must be accepted.',
        missingStatements: missingAccepted,
      },
      { status: 400 }
    );
  }

  try {
    const ipHash = hashForLog(getClientIp(req));
    const deviceFingerprintHash = hashForLog(req.headers.get('x-device-id'));

    const acceptanceResult = await recordHomeownerPolicyAcceptance({
      userId: me.id,
      signatureName,
      acceptedStatements: acceptedStatements as Prisma.InputJsonValue,
      address,
      notificationPreference,
      approvedSupportContacts: ((body as Record<string, unknown>).approvedSupportContacts ?? null) as
        | Prisma.InputJsonValue
        | null,
      ipHash,
      deviceFingerprintHash,
      pendingOnboardingId,
    });

    let emailNotificationsSent = false;
    let deliverySummary: Array<{
      recipientType: string;
      recipientEmailMasked: string;
      status: string;
      error?: string;
    }> = [];

    if (acceptanceResult.created) {
      const sendResult = await sendHomeownerPolicyAcceptedEmails({
        acceptanceId: acceptanceResult.acceptance.id,
        homeId: acceptanceResult.homeId,
        homeownerUserId: me.id,
        policyVersion: acceptanceResult.acceptance.policyVersion,
      });
      emailNotificationsSent = sendResult.allSent;
      deliverySummary = sendResult.results.map((item) => ({
        recipientType: item.recipientType,
        recipientEmailMasked: maskEmail(item.recipientEmail),
        status: item.status,
        error: item.error,
      }));
    }

    return NextResponse.json({
      ok: true,
      created: acceptanceResult.created,
      acceptanceId: acceptanceResult.acceptance.id,
      policyVersion: acceptanceResult.acceptance.policyVersion,
      acceptedAt: acceptanceResult.acceptance.acceptedAt,
      pendingOnboardingId: acceptanceResult.pendingOnboardingId,
      emailNotificationsSent,
      deliverySummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record homeowner policy acceptance.';
    const status = message.toLowerCase().includes('email verification') ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
