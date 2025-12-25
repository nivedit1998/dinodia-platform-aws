import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getCloudEnabledForUser } from '@/lib/haConnection';
import { Role } from '@prisma/client';

export default async function TenantPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) {
    redirect('/admin/settings');
  }

  const cloudEnabled = await getCloudEnabledForUser(user.id);
  if (!cloudEnabled) redirect('/cloud-locked');

  redirect('/tenant/dashboard');
}
