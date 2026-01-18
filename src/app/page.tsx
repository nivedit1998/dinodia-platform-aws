import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';

export default async function Home() {
  const user = await getCurrentUser();
  if (user) {
    if (user.role === Role.INSTALLER) {
      redirect('/installer/provision');
    }

    if (user.role === Role.ADMIN) redirect('/admin/dashboard');
    else redirect('/tenant/dashboard');
  }

  redirect('/login');
}
