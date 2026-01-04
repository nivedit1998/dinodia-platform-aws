import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';
import { EntityAccessError, assertTenantEntityAccess, parseEntityId } from '@/lib/entityAccess';

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  let entityId: string;
  try {
    const parsed = parseEntityId(req.nextUrl.searchParams.get('entityId'));
    if (parsed.domain !== 'camera') {
      return NextResponse.json({ error: 'entityId must be a camera.* entity' }, { status: 400 });
    }
    entityId = parsed.entityId;
  } catch (err) {
    const status = err instanceof EntityAccessError ? err.status : 400;
    const message = err instanceof Error ? err.message : 'Invalid entityId';
    return NextResponse.json({ error: message }, { status });
  }

  let haConnection;
  let fullUser;
  try {
    ({ haConnection, user: fullUser } = await getUserWithHaConnection(user.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'HA connection missing' },
      { status: 400 }
    );
  }

  try {
    await assertTenantEntityAccess({
      user,
      accessRules: fullUser?.accessRules ?? [],
      haConnectionId: haConnection.id,
      entityId,
      options: { cacheTtlMs: 10_000 },
    });
  } catch (err) {
    if (err instanceof EntityAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const effectiveHa = resolveHaCloudFirst(haConnection);

  const url = `${effectiveHa.baseUrl}/api/camera_proxy/${encodeURIComponent(entityId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${effectiveHa.longLivedToken}`,
    },
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `Camera proxy error ${res.status}: ${body}` },
      { status: 502 }
    );
  }

  const headers = new Headers();
  headers.set('Content-Type', res.headers.get('Content-Type') || 'image/jpeg');
  headers.set('Cache-Control', 'no-store');
  return new NextResponse(res.body, { status: res.status, headers });
}
