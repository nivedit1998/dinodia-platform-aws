import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import PatchManagementClient from './PatchManagementClient';

export const dynamic = 'force-dynamic';

export default async function InstallerCePlusPatchManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <PatchManagementClient installerName={user.username} />;
}

