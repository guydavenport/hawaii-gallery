import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';

const SSM_PREFIX = process.env.CONFIG_SSM_PREFIX || '/hawaii-gallery/prod/';

let loadPromise: Promise<void> | null = null;

async function loadFromSSM(): Promise<void> {
  const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new GetParametersByPathCommand({ Path: SSM_PREFIX, WithDecryption: true, NextToken: nextToken })
    );

    for (const param of response.Parameters || []) {
      const name = param.Name?.slice(SSM_PREFIX.length);
      if (name && param.Value && !process.env[name]) {
        process.env[name] = param.Value;
      }
    }

    nextToken = response.NextToken;
  } while (nextToken);
}

// Amplify Hosting's console/CLI "environment variables" are not exposed to the
// Next.js SSR compute runtime for this app, only to the build. Config is stored
// in SSM instead and pulled into process.env on first use per warm container.
export async function ensureConfigLoaded(): Promise<void> {
  if (process.env.SESSION_SECRET && process.env.COGNITO_CLIENT_ID && process.env.S3_BUCKET) {
    return;
  }
  if (!loadPromise) {
    loadPromise = loadFromSSM();
  }
  await loadPromise;
}
