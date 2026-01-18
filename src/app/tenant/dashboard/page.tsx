import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';
import TenantDashboard from '../ui/TenantDashboard';

export default async function TenantDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) redirect('/admin/settings');

  return <TenantDashboard username={user.username} />;
}
