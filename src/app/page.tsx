import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getCloudEnabledForUser } from '@/lib/haConnection';
import { Role } from '@prisma/client';

export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    const cloudEnabled = await getCloudEnabledForUser(user.id);
    if (!cloudEnabled) redirect('/cloud-locked');

    if (user.role === Role.ADMIN) redirect('/admin/dashboard');
    else redirect('/tenant/dashboard');
  }

  redirect('/login');
}
