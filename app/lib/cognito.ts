import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

export async function verifyCognitoCredentials(email: string, password: string): Promise<boolean> {
  const clientId = requireEnv('COGNITO_CLIENT_ID');
  try {
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      })
    );
    return Boolean(result.AuthenticationResult);
  } catch {
    return false;
  }
}
