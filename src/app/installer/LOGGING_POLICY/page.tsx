import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import LoggingPolicyClient from './LoggingPolicyClient';

export const dynamic = 'force-dynamic';

export default async function InstallerLoggingPolicyPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <LoggingPolicyClient installerName={user.username} />;
}

