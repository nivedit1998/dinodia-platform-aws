import { NextResponse } from 'next/server';
import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/authErrorCodes';
import { revokeLoginIntent } from '@/lib/loginIntents';

function fail(status: number, errorCode: AuthErrorCode, error: string) {
  return NextResponse.json({ ok: false, errorCode, error }, { status });
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return fail(400, AUTH_ERROR_CODES.INVALID_LOGIN_INPUT, 'Login session id is required.');
    }
    await revokeLoginIntent(id);
    return NextResponse.json({ ok: true });
  } catch {
    return fail(500, AUTH_ERROR_CODES.INTERNAL_ERROR, 'Unable to expire login session right now.');
  }
}
