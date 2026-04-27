import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { getHomeownerPolicyStatus } from '@/lib/homeownerPolicy';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  if (user.role !== Role.ADMIN) {
    redirect('/');
  }

  const policy = await getHomeownerPolicyStatus(user.id);
  if (policy?.requiresAcceptance) {
    redirect('/homeowner/policy');
  }

  return <>{children}</>;
}
