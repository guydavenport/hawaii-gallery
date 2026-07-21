import type { OAuthProvider } from './types';

function clientId() {
  return process.env.GOOGLE_CLIENT_ID || '';
}

function clientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET || '';
}

interface GoogleTokenResponse {
  id_token?: string;
}

interface GoogleTokenInfo {
  sub: string;
  aud?: string;
  email?: string;
  email_verified?: string;
  name?: string;
}

export const googleProvider: OAuthProvider = {
  id: 'google',
  label: 'Google',

  isConfigured() {
    return Boolean(clientId() && clientSecret());
  },

  getAuthUrl(redirectUri, state) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri) {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed: ${await tokenResponse.text()}`);
    }
    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokens.id_token) {
      throw new Error('Google token response missing id_token');
    }

    // Validate + decode the id_token via Google's tokeninfo endpoint rather than
    // verifying the JWT signature locally against Google's JWKS — avoids a JWT
    // dependency for what is a single low-QPS call.
    const infoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`
    );
    if (!infoResponse.ok) {
      throw new Error(`Google tokeninfo failed: ${await infoResponse.text()}`);
    }
    const info = (await infoResponse.json()) as GoogleTokenInfo;

    if (info.aud !== clientId()) {
      throw new Error('Google id_token audience mismatch');
    }
    if (!info.email || info.email_verified !== 'true') {
      throw new Error('Google account email is not verified');
    }

    return { providerId: info.sub, email: info.email.toLowerCase(), name: info.name || info.email };
  },
};
