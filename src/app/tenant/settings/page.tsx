import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';
import TenantSettings from '../ui/TenantSettings';

export default async function TenantSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) redirect('/admin/dashboard');

  return <TenantSettings username={user.username} />;
}
