import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { Role } from '@prisma/client';
import TenantDashboard from '../ui/TenantDashboard';

export default async function TenantDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) redirect('/admin/settings');

  const { haConnection } = await getUserWithHaConnection(user.id);
  const cloudUrl = haConnection.cloudUrl?.trim();
  if (!cloudUrl) redirect('/tenant/cloud-locked');

  return <TenantDashboard username={user.username} />;
}
