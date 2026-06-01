import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import AssetInventoryClient from './AssetInventoryClient';

export const dynamic = 'force-dynamic';

export default async function InstallerCePlusAssetInventoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <AssetInventoryClient installerName={user.username} />;
}

