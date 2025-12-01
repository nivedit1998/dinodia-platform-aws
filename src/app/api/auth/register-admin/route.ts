import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, createToken, setAuthCookie } from '@/lib/auth';
import { Role } from '@prisma/client';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      username,
      password,
      haUsername,
      haPassword,
      haBaseUrl,
      haLongLivedToken,
    } = body;

    if (!username || !password || !haUsername || !haPassword || !haBaseUrl || !haLongLivedToken) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    const admin = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: Role.ADMIN,
      },
    });

    const haConnection = await prisma.haConnection.create({
      data: {
        baseUrl: haBaseUrl.trim().replace(/\/+$/, ''),
        haUsername,
        haPassword,
        longLivedToken: haLongLivedToken,
        ownerId: admin.id,
      },
    });

    await prisma.user.update({
      where: { id: admin.id },
      data: { haConnectionId: haConnection.id },
    });

    const token = createToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
    });

    await setAuthCookie(token);

    return NextResponse.json({ ok: true, role: admin.role });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
