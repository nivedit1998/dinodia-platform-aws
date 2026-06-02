import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import ISO27001ScopeClient from './ISO27001ScopeClient';

export const dynamic = 'force-dynamic';

export default async function InstallerISO27001ScopePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <ISO27001ScopeClient installerName={user.username} />;
}

