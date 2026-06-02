import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { CompanyPortalShell } from '@/components/companyPortal/CompanyPortalShell';
import { canAccessGdpr, getCompanyLandingPath } from '@/lib/companyPortalAccess';
import GdprStatusClient from './GdprStatusClient';

export const dynamic = 'force-dynamic';

export default async function InstallerGdprStatusPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/companylogin/login');
  if (!canAccessGdpr(user.role)) redirect(getCompanyLandingPath(user.role));

  return (
    <CompanyPortalShell username={user.username} role={user.role}>
      <GdprStatusClient installerName={user.username} />
    </CompanyPortalShell>
  );
}
