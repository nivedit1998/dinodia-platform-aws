import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { CompanyPortalShell } from '@/components/companyPortal/CompanyPortalShell';
import { getCompanyLandingPath } from '@/lib/companyPortalAccess';
import PatchManagementClient from './PatchManagementClient';

export const dynamic = 'force-dynamic';

export default async function InstallerCePlusPatchManagementPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/companylogin/login');
  if (user.role !== Role.CXO) redirect(getCompanyLandingPath(user.role));

  return (
    <CompanyPortalShell username={user.username} role={user.role}>
      <PatchManagementClient installerName={user.username} />
    </CompanyPortalShell>
  );
}

