import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import CePlusOverviewClient from './CePlusOverviewClient';

export const dynamic = 'force-dynamic';

export default async function InstallerCePlusOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <CePlusOverviewClient installerName={user.username} />;
}

