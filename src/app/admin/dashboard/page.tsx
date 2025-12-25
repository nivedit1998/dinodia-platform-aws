import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getCloudEnabledForUser } from '@/lib/haConnection';
import { Role } from '@prisma/client';
import AdminDashboard from '../ui/AdminDashboard';

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.ADMIN) redirect('/tenant/dashboard');

  const cloudEnabled = await getCloudEnabledForUser(user.id);
  if (!cloudEnabled) redirect('/cloud-locked');

  return <AdminDashboard username={user.username} />;
}
