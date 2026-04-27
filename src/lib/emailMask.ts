export function maskEmailForTenantRoster(email: string): string {
  const trimmed = (email ?? '').trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const first = local[0] ?? '*';
  return `${first}***@${domain}`;
}
