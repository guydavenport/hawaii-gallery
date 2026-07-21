export interface OAuthUserInfo {
  providerId: string;
  email: string;
  name: string;
}

export interface OAuthProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  getAuthUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthUserInfo>;
}
