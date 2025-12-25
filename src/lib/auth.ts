import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { Role } from '@prisma/client';

const JWT_COOKIE_NAME = 'dinodia_token';

export type AuthUser = {
  id: number;
  username: string;
  role: Role;
};

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error('JWT_SECRET not set');

async function findAuthUserById(id: number): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, role: true },
  });
  return user ?? null;
}

export async function getUserFromToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    return await findAuthUserById(payload.id);
  } catch {
    return null;
  }
}

function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function getUserFromAuthorizationHeader(authHeader: string | null | undefined) {
  return getUserFromToken(extractBearerToken(authHeader));
}

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createToken(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.set(JWT_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(JWT_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    // Make sure user still exists
    return await findAuthUserById(payload.id);
  } catch {
    return null;
  }
}

export async function authenticateWithCredentials(username: string, password: string): Promise<AuthUser | null> {
  if (!username || !password) return null;

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      role: true,
      passwordHash: true,
    },
  });

  if (!user) return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  return { id: user.id, username: user.username, role: user.role };
}

export async function createSessionForUser(user: AuthUser) {
  const token = createToken(user);
  await setAuthCookie(token);
}

export async function getCurrentUserFromRequest(req: NextRequest): Promise<AuthUser | null> {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    return getUserFromAuthorizationHeader(authHeader);
  }
  return getCurrentUser();
}

export function createTokenForUser(user: AuthUser): string {
  return createToken(user);
}
