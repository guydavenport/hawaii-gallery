import { NextRequest, NextResponse } from 'next/server';
import { getOAuthProvider } from '@/app/lib/oauth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function GET(request: NextRequest, { params }: { params: { provider: string } }) {
  await ensureConfigLoaded();
  const provider = getOAuthProvider(params.provider);
  if (!provider || !provider.isConfigured()) {
    return NextResponse.json({ error: 'Provider not available' }, { status: 404 });
  }

  const redirectUri = `${request.nextUrl.origin}/api/auth/oauth/${provider.id}/callback`;
  const state = crypto.randomUUID();
  const authUrl = provider.getAuthUrl(redirectUri, state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(`oauth_state_${provider.id}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}
