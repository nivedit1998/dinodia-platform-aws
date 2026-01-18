import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import TenantAutomations from '@/app/tenant/ui/TenantAutomations';

export default async function TenantAutomationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) redirect('/admin/settings');

  return <TenantAutomations />;
}
