import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const entityId = req.nextUrl.searchParams.get('entityId');
  if (!entityId) {
    return NextResponse.json({ error: 'Missing entityId' }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { haConnection: true },
  });

  if (!dbUser?.haConnection) {
    return NextResponse.json({ error: 'HA connection missing' }, { status: 400 });
  }

  const url = `${dbUser.haConnection.baseUrl}/api/camera_proxy/${entityId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${dbUser.haConnection.longLivedToken}`,
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
