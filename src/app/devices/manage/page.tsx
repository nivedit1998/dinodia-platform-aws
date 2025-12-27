import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ManageDevices from './ui/ManageDevices';

export const dynamic = 'force-dynamic';

export default async function ManageDevicesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return <ManageDevices />;
}
