import { NextRequest, NextResponse } from 'next/server';
import { resendCognitoConfirmationCode } from '@/app/lib/cognito';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function POST(request: NextRequest) {
  await ensureConfigLoaded();

  const data = await request.json();
  const email = data?.email?.toString().trim().toLowerCase() || '';
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  await resendCognitoConfirmationCode(email);
  // Always report success — don't reveal whether the email is registered.
  return NextResponse.json({ ok: true });
}
