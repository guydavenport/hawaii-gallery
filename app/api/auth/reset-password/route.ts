import { NextRequest, NextResponse } from 'next/server';
import { confirmCognitoPasswordReset } from '@/app/lib/cognito';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function POST(request: NextRequest) {
  await ensureConfigLoaded();

  const data = await request.json();
  const email = data?.email?.toString().trim().toLowerCase() || '';
  const code = data?.code?.toString().trim() || '';
  const password = data?.password?.toString() || '';

  if (!email || !code || !password) {
    return NextResponse.json({ error: 'Email, code, and new password are required' }, { status: 400 });
  }

  const ok = await confirmCognitoPasswordReset(email, code, password);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
