import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import SupabasePrivacyHardeningClient from './SupabasePrivacyHardeningClient';

export const dynamic = 'force-dynamic';

export default async function InstallerSupabasePrivacyHardeningPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <SupabasePrivacyHardeningClient installerName={user.username} />;
}

