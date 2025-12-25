import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaCloudFirst } from '@/lib/haConnection';

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  const entityId = req.nextUrl.searchParams.get('entityId');
  if (!entityId) {
    return NextResponse.json({ error: 'Missing entityId' }, { status: 400 });
  }

  let haConnection;
  try {
    ({ haConnection } = await getUserWithHaConnection(user.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'HA connection missing' },
      { status: 400 }
    );
  }

  const effectiveHa = resolveHaCloudFirst(haConnection);

  const url = `${effectiveHa.baseUrl}/api/camera_proxy/${entityId}`;
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
