import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';

function parseHomeId(raw: string | null): number | null {
  if (!raw) return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parseSerial(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const homeId = parseHomeId(req.nextUrl.searchParams.get('homeId'));
  const serial = parseSerial(req.nextUrl.searchParams.get('serial'));

  if (homeId && serial) {
    return NextResponse.json(
      { error: 'Provide either homeId or serial, not both.' },
      { status: 400 }
    );
  }
  if (!homeId && !serial) {
    return NextResponse.json(
      { error: 'homeId or serial is required.' },
      { status: 400 }
    );
  }

  let data: Array<{ homeId: number; installedAt: Date }> = [];

  if (homeId) {
    const home = await prisma.home.findUnique({
      where: { id: homeId },
      select: {
        id: true,
        createdAt: true,
        hubInstall: { select: { createdAt: true } },
      },
    });

    if (home) {
      data = [
        {
          homeId: home.id,
          installedAt: home.hubInstall?.createdAt ?? home.createdAt,
        },
      ];
    }
  } else if (serial) {
    const hubInstall = await prisma.hubInstall.findUnique({
      where: { serial },
      select: {
        createdAt: true,
        home: {
          select: {
            id: true,
            createdAt: true,
          },
        },
      },
    });

    if (hubInstall?.home) {
      data = [
        {
          homeId: hubInstall.home.id,
          installedAt: hubInstall.createdAt ?? hubInstall.home.createdAt,
        },
      ];
    }
  }

  return NextResponse.json({ ok: true, homes: data });
}
