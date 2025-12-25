import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { getCloudEnabledForUser } from '@/lib/haConnection';
import TenantAutomations from '@/app/tenant/ui/TenantAutomations';

export default async function TenantAutomationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) redirect('/admin/settings');

  const cloudEnabled = await getCloudEnabledForUser(user.id);
  if (!cloudEnabled) redirect('/cloud-locked');

  return <TenantAutomations />;
}
