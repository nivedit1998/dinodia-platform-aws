import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import SecureConfigurationClient from './SecureConfigurationClient';

export const dynamic = 'force-dynamic';

export default async function InstallerCePlusSecureConfigurationPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <SecureConfigurationClient installerName={user.username} />;
}

