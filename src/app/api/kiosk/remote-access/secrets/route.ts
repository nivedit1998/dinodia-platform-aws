import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { readDeviceHeaders } from '@/lib/deviceAuth';
import { ensureActiveDevice } from '@/lib/deviceRegistry';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { consumeStepUpApproval } from '@/lib/stepUp';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user || user.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const { deviceId } = readDeviceHeaders(req);
  if (!deviceId) {
    return NextResponse.json({ error: 'Device id is required.' }, { status: 400 });
  }

  try {
    await ensureActiveDevice(deviceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'This device is blocked.';
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const approval = await consumeStepUpApproval(user.id, deviceId, StepUpPurpose.REMOTE_ACCESS_SETUP);
  if (!approval) {
    return NextResponse.json(
      { error: 'Email verification is required.', stepUpRequired: true },
      { status: 403 }
    );
  }

  try {
    const { haConnection } = await getUserWithHaConnection(user.id);
    return NextResponse.json({
      baseUrl: haConnection.baseUrl,
      cloudUrl: haConnection.cloudUrl,
      longLivedToken: haConnection.longLivedToken,
      haUsername: haConnection.haUsername,
      haPassword: haConnection.haPassword,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to load Dinodia Hub settings.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
