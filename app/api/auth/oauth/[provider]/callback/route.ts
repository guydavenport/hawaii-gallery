import { NextRequest, NextResponse } from 'next/server';
import { getOAuthProvider } from '@/app/lib/oauth';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/app/lib/auth';
import { resolveAccess } from '@/app/lib/access-control';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function GET(request: NextRequest, { params }: { params: { provider: string } }) {
  await ensureConfigLoaded();
  const provider = getOAuthProvider(params.provider);
  const clearStateCookie = (response: NextResponse) => {
    response.cookies.set(`oauth_state_${params.provider}`, '', { path: '/', maxAge: 0 });
    return response;
  };

  if (!provider || !provider.isConfigured()) {
    return clearStateCookie(NextResponse.redirect(new URL('/?accessStatus=unavailable', request.url)));
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(`oauth_state_${provider.id}`)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return clearStateCookie(NextResponse.redirect(new URL('/?accessStatus=invalid', request.url)));
  }

  const redirectUri = `${request.nextUrl.origin}/api/auth/oauth/${provider.id}/callback`;

  let userInfo;
  try {
    userInfo = await provider.exchangeCode(code, redirectUri);
  } catch (error) {
    console.error(`OAuth exchange failed for ${provider.id}`, error);
    return clearStateCookie(NextResponse.redirect(new URL('/?accessStatus=invalid', request.url)));
  }

  const resolution = await resolveAccess({
    email: userInfo.email,
    name: userInfo.name,
    provider: provider.id,
    providerId: userInfo.providerId,
  });

  if (resolution.status !== 'approved') {
    return clearStateCookie(NextResponse.redirect(new URL(`/?accessStatus=${resolution.status}`, request.url)));
  }

  const { token, maxAge } = await createSessionToken({ username: userInfo.email, role: resolution.role });
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return clearStateCookie(response);
}
