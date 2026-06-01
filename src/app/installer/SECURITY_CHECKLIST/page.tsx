import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import SecurityChecklistClient from './SecurityChecklistClient';

export const dynamic = 'force-dynamic';

export default async function InstallerSecurityChecklistPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <SecurityChecklistClient installerName={user.username} />;
}

