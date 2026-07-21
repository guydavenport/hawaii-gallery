import { NextRequest, NextResponse } from 'next/server';
import { confirmCognitoSignUp } from '@/app/lib/cognito';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function POST(request: NextRequest) {
  await ensureConfigLoaded();

  const data = await request.json();
  const email = data?.email?.toString().trim().toLowerCase() || '';
  const code = data?.code?.toString().trim() || '';

  if (!email || !code) {
    return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
  }

  const ok = await confirmCognitoSignUp(email, code);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
