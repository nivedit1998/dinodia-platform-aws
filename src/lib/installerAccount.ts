import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';

const AUTO_ENABLED = process.env.INSTALLER_AUTO_PROVISION_ENABLED
  ? process.env.INSTALLER_AUTO_PROVISION_ENABLED.toLowerCase() !== 'false'
  : true;

const ALLOW_UPDATES =
  (process.env.INSTALLER_ALLOW_UPDATES ?? '').toLowerCase() === 'true' ||
  (process.env.INSTALLER_FORCE_SYNC ?? '').toLowerCase() === 'true';

export async function ensureInstallerAccount() {
  if (!AUTO_ENABLED) return;

  const username = process.env.INSTALLER_USERNAME;
  const password = process.env.INSTALLER_PASSWORD;
  const email = process.env.INSTALLER_EMAIL;

  if (!username || !password || !email) return;

  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findUnique({
    where: { username },
    select: { id: true, role: true },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: Role.INSTALLER,
        email,
        emailVerifiedAt: new Date(),
        emailPending: null,
        email2faEnabled: false,
        homeId: null,
        haConnectionId: null,
      },
    });
    return;
  }

  if (!ALLOW_UPDATES) {
    if (existing.role !== Role.INSTALLER) {
      console.warn(
        '[installerAccount] Installer account exists with different role; set INSTALLER_ALLOW_UPDATES=true to resync.'
      );
    }
    return;
  }

  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: Role.INSTALLER,
      email,
      emailVerifiedAt: new Date(),
      emailPending: null,
      passwordHash,
      homeId: null,
      haConnectionId: null,
    },
  });
}
