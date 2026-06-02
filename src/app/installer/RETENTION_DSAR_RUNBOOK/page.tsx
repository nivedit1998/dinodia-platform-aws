import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import RetentionDsarRunbookClient from './RetentionDsarRunbookClient';

export const dynamic = 'force-dynamic';

export default async function InstallerRetentionDsarRunbookPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <RetentionDsarRunbookClient installerName={user.username} />;
}

