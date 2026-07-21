import { NextRequest, NextResponse } from 'next/server';
import { signUpWithCognito } from '@/app/lib/cognito';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function POST(request: NextRequest) {
  await ensureConfigLoaded();

  const data = await request.json();
  const email = data?.email?.toString().trim().toLowerCase() || '';
  const password = data?.password?.toString() || '';
  const name = data?.name?.toString().trim() || '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const result = await signUpWithCognito(email, password, name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
