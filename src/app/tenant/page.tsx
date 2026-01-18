import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';

export default async function TenantPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) {
    redirect('/admin/settings');
  }

  redirect('/tenant/dashboard');
}
