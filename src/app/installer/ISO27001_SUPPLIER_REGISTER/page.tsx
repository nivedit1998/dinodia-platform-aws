import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import ISO27001SupplierRegisterClient from './ISO27001SupplierRegisterClient';

export const dynamic = 'force-dynamic';

export default async function InstallerISO27001SupplierRegisterPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <ISO27001SupplierRegisterClient installerName={user.username} />;
}

