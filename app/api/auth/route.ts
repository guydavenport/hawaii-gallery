import { NextRequest, NextResponse } from 'next/server';
import { verifyCognitoCredentials } from '@/app/lib/cognito';
import { createSessionToken, requireSession, timingSafeEqual, SESSION_COOKIE_NAME } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function GET(request: NextRequest) {
  await ensureConfigLoaded();
  const session = await requireSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({ authenticated: true, username: session.username, role: session.role });
}

export async function POST(request: NextRequest) {
  await ensureConfigLoaded();

  const data = await request.json();
  const email = data?.email?.toString().trim().toLowerCase() || '';
  const password = data?.password?.toString() || '';

  if (!password) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  let session: { username: string; role: 'admin' | 'guest' };

  if (email) {
    const valid = await verifyCognitoCredentials(email, password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    session = { username: email, role: 'admin' };
  } else {
    const guestPasswords = (process.env.GUEST_PASSWORD || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const valid = guestPasswords.some((guestPassword) => timingSafeEqual(password, guestPassword));
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }
    session = { username: 'guest', role: 'guest' };
  }

  const { token, maxAge } = await createSessionToken(session);
  const response = NextResponse.json({ ok: true, username: session.username, role: session.role });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
