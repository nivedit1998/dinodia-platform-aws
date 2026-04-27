import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { Role } from '@prisma/client';
import { getHomeownerPolicyStatus } from '@/lib/homeownerPolicy';

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ user: null });
  if (user.role !== Role.ADMIN) {
    return NextResponse.json({ user });
  }
  const policy = await getHomeownerPolicyStatus(user.id);
  return NextResponse.json({
    user,
    requiresHomeownerPolicyAcceptance: policy?.requiresAcceptance ?? true,
    homeownerPolicyVersion: policy?.policyVersion ?? '2026-V1',
    pendingOnboardingId: policy?.pendingOnboardingId ?? null,
  });
}
