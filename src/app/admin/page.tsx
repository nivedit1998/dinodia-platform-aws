import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getCloudEnabledForUser } from '@/lib/haConnection';
import { Role } from '@prisma/client';

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.ADMIN) {
    redirect('/tenant/dashboard');
  }

  const cloudEnabled = await getCloudEnabledForUser(user.id);
  if (!cloudEnabled) redirect('/cloud-locked');

  redirect('/admin/dashboard');
}
