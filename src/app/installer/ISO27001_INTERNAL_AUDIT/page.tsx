import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import ISO27001InternalAuditClient from './ISO27001InternalAuditClient';

export const dynamic = 'force-dynamic';

export default async function InstallerISO27001InternalAuditPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <ISO27001InternalAuditClient installerName={user.username} />;
}

