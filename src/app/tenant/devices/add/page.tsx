import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import AddMatterDeviceWizard from '../../ui/AddMatterDeviceWizard';
import { CAPABILITIES } from '@/lib/deviceCapabilities';

export default async function AddMatterDevicePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.TENANT) redirect('/admin/settings');

  const accessRules = await prisma.accessRule.findMany({
    where: { userId: user.id },
    select: { area: true },
  });
  const areas = Array.from(new Set(accessRules.map((rule) => rule.area))).sort((a, b) =>
    a.localeCompare(b)
  );
  const capabilityOptions = Object.keys(CAPABILITIES);

  return <AddMatterDeviceWizard areas={areas} capabilityOptions={capabilityOptions} />;
}
