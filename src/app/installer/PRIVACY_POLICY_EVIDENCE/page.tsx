import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { PRIVACY_NOTICE_LAST_UPDATED, PRIVACY_NOTICE_VERSION, TERMS_LAST_UPDATED, TERMS_VERSION } from '@/lib/policyVersions';
import PrivacyPolicyEvidenceClient from './PrivacyPolicyEvidenceClient';

export const dynamic = 'force-dynamic';

export default async function InstallerPrivacyPolicyEvidencePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return (
    <PrivacyPolicyEvidenceClient
      installerName={user.username}
      privacyVersion={PRIVACY_NOTICE_VERSION}
      privacyLastUpdated={PRIVACY_NOTICE_LAST_UPDATED}
      termsVersion={TERMS_VERSION}
      termsLastUpdated={TERMS_LAST_UPDATED}
    />
  );
}

