import { NextRequest } from 'next/server';
import { AuthUser, getCurrentUserFromRequest } from '@/lib/auth';

export async function resolveAlexaAuthUser(req: NextRequest): Promise<AuthUser | null> {
  return getCurrentUserFromRequest(req);
}
