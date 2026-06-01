import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import GdprStatusClient from './GdprStatusClient';

export const dynamic = 'force-dynamic';

export default async function InstallerGdprStatusPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <GdprStatusClient installerName={user.username} />;
}

