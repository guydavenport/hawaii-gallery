import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

interface CognitoAuthResult {
  email: string;
  name: string;
}

function decodeIdTokenClaims(idToken: string): { email?: string; name?: string } {
  const payload = idToken.split('.')[1];
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json);
}

export async function verifyCognitoCredentials(email: string, password: string): Promise<CognitoAuthResult | null> {
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  try {
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      })
    );
    const idToken = result.AuthenticationResult?.IdToken;
    if (!idToken) return null;
    const claims = decodeIdTokenClaims(idToken);
    if (!claims.email) return null;
    return { email: claims.email.toLowerCase(), name: claims.name || claims.email };
  } catch {
    return null;
  }
}

export async function signUpWithCognito(
  email: string,
  password: string,
  name: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  try {
    await client.send(
      new SignUpCommand({
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'name', Value: name || email },
        ],
      })
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as { message?: string }).message || 'Sign up failed' };
  }
}

export async function confirmCognitoSignUp(email: string, code: string): Promise<boolean> {
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  try {
    await client.send(new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: code }));
    return true;
  } catch {
    return false;
  }
}

export async function resendCognitoConfirmationCode(email: string): Promise<boolean> {
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  try {
    await client.send(new ResendConfirmationCodeCommand({ ClientId: clientId, Username: email }));
    return true;
  } catch {
    return false;
  }
}

export async function startCognitoPasswordReset(email: string): Promise<boolean> {
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  try {
    await client.send(new ForgotPasswordCommand({ ClientId: clientId, Username: email }));
    return true;
  } catch {
    return false;
  }
}

export async function confirmCognitoPasswordReset(email: string, code: string, newPassword: string): Promise<boolean> {
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  try {
    await client.send(
      new ConfirmForgotPasswordCommand({
        ClientId: clientId,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      })
    );
    return true;
  } catch {
    return false;
  }
}
