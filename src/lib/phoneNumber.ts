export function normalizePhoneNumberE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Allow user-friendly formatting characters, but require a strict E.164 output.
  const cleaned = trimmed.replace(/[\s()-]/g, '');
  if (!cleaned.startsWith('+')) return null;

  const digits = cleaned.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits[0] === '0') return null;

  return `+${digits}`;
}

