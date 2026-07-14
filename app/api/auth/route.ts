import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const data = await request.json();
  const email = data?.email?.toString().trim() || '';
  const password = data?.password?.toString() || '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: 'Demo auth accepted. Replace this route with AWS Cognito or Amplify auth in production.',
    email,
  });
}
