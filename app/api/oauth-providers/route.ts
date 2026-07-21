import { NextResponse } from 'next/server';
import { OAUTH_PROVIDERS } from '@/app/lib/oauth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function GET() {
  await ensureConfigLoaded();
  const providers = Object.values(OAUTH_PROVIDERS)
    .filter((provider) => provider.isConfigured())
    .map((provider) => ({ id: provider.id, label: provider.label }));
  return NextResponse.json({ providers });
}
