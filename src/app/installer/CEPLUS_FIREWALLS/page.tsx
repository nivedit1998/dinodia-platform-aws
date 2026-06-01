import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import FirewallsClient from './FirewallsClient';

export const dynamic = 'force-dynamic';

export default async function InstallerCePlusFirewallsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <FirewallsClient installerName={user.username} />;
}

