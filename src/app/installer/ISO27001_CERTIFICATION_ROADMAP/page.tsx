import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import ISO27001CertificationRoadmapClient from './ISO27001CertificationRoadmapClient';

export const dynamic = 'force-dynamic';

export default async function InstallerISO27001CertificationRoadmapPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <ISO27001CertificationRoadmapClient installerName={user.username} />;
}

