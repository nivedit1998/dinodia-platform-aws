import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import AccessControlClient from './AccessControlClient';

export const dynamic = 'force-dynamic';

export default async function InstallerCePlusAccessControlPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <AccessControlClient installerName={user.username} />;
}

