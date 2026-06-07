import { prisma } from '@/lib/prisma';
import { normalizeLookupKey } from '@/lib/displayNormalization';

export function cleanAreaName(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text || text.toLowerCase() === 'unassigned') return null;
  return text;
}

export async function buildAreaAccessMatcher(args: {
  haConnectionId: number;
  accessAreas: Array<string | null | undefined>;
}) {
  const allowedNames = new Set<string>();
  const allowedKeys = new Set<string>();
  for (const area of args.accessAreas) {
    const cleaned = cleanAreaName(area);
    if (!cleaned) continue;
    allowedNames.add(cleaned);
    allowedKeys.add(normalizeLookupKey(cleaned));
  }

  const overrides = await prisma.areaDisplayOverride.findMany({
    where: { haConnectionId: args.haConnectionId },
    select: { haAreaName: true, displayName: true, displayKey: true },
  });
  const overrideByOriginal = new Map(overrides.map((row) => [row.haAreaName, row]));

  const displayNameForArea = (area: string | null | undefined) => {
    const cleaned = cleanAreaName(area);
    if (!cleaned) return null;
    return overrideByOriginal.get(cleaned)?.displayName || cleaned;
  };

  const hasAreaAccess = (area: string | null | undefined) => {
    const cleaned = cleanAreaName(area);
    if (!cleaned) return false;
    if (allowedNames.has(cleaned)) return true;
    const displayName = displayNameForArea(cleaned);
    return Boolean(displayName && allowedKeys.has(normalizeLookupKey(displayName)));
  };

  return { hasAreaAccess, displayNameForArea, allowedNames, allowedKeys };
}
