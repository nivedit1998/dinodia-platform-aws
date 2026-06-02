import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '@/lib/policyVersions';
import PolicyAcceptanceEvidenceClient from './PolicyAcceptanceEvidenceClient';

export const dynamic = 'force-dynamic';

export default async function InstallerPolicyAcceptanceEvidencePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return (
    <PolicyAcceptanceEvidenceClient
      installerName={user.username}
      privacyVersion={PRIVACY_NOTICE_VERSION}
      termsVersion={TERMS_VERSION}
    />
  );
}

