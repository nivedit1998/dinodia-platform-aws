import { LoginClient } from '@/app/login/LoginClient';

export default async function TenantLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.identifier;
  const identifier = (Array.isArray(raw) ? raw[0] : raw)?.toString() ?? '';
  return <LoginClient expectedRole="TENANT" initialIdentifier={identifier} />;
}

