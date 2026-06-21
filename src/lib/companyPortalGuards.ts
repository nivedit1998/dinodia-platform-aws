import 'server-only';

import { type NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';
import {
  canAccessHomeSupport,
  canAccessProvision,
  canFinishRemoveHome,
  canManageHomeSupportQrRooms,
  canStartRemoveHome,
} from '@/lib/companyPortalAccess';

export type CompanyPortalOperatorContext = {
  userId: number;
  username: string;
  role: Role;
};

async function requireCompanyOperator(
  req: NextRequest,
  predicate: (role: Role | null | undefined) => boolean,
  unauthorizedMessage = 'Your session has ended. Please sign in again.'
): Promise<CompanyPortalOperatorContext | NextResponse> {
  const me = await getCurrentUserFromRequest(req);
  if (!me || !predicate(me.role)) {
    return NextResponse.json({ error: unauthorizedMessage }, { status: 401 });
  }

  try {
    await requireTrustedPrivilegedDevice(req, me.id);
  } catch (err) {
    const deviceResponse = toTrustedDeviceResponse(err);
    if (deviceResponse) return deviceResponse;
    throw err;
  }

  return {
    userId: me.id,
    username: me.username,
    role: me.role,
  };
}

export async function requireCompanyHomeSupportViewer(req: NextRequest) {
  return requireCompanyOperator(req, canAccessHomeSupport, 'Company Home Support access required.');
}

export async function requireCompanyHomeSupportQrOperator(req: NextRequest) {
  return requireCompanyOperator(req, canManageHomeSupportQrRooms, 'Company QR room management access required.');
}

export async function requireCompanyProvisionOperator(req: NextRequest) {
  return requireCompanyOperator(req, canAccessProvision, 'Company provisioning access required.');
}

export async function requireCompanyHomeRemovalOperator(
  req: NextRequest,
  mode: 'start' | 'finish' = 'start'
) {
  return requireCompanyOperator(
    req,
    mode === 'finish' ? canFinishRemoveHome : canStartRemoveHome,
    'Company home removal access required.'
  );
}
