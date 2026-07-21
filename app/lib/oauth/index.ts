import type { OAuthProvider } from './types';
import { googleProvider } from './google';

// Add Apple/Facebook providers here later — each just needs to implement
// OAuthProvider; the start/callback routes and admin approval flow are
// already provider-agnostic.
export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: googleProvider,
};

export function getOAuthProvider(id: string): OAuthProvider | null {
  return OAUTH_PROVIDERS[id] || null;
}

export type { OAuthProvider, OAuthUserInfo } from './types';
