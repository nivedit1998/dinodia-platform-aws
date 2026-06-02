import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import ISO27001RiskRegisterClient from './ISO27001RiskRegisterClient';

export const dynamic = 'force-dynamic';

export default async function InstallerISO27001RiskRegisterPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <ISO27001RiskRegisterClient installerName={user.username} />;
}

