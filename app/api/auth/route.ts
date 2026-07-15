import { NextRequest, NextResponse } from 'next/server';
import { verifyCognitoCredentials } from '@/app/lib/cognito';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/app/lib/auth';

export async function GET() {
  const keys = Object.keys(process.env).sort();
  return NextResponse.json({
    keys,
    hasCognitoClientId: Boolean(process.env.COGNITO_CLIENT_ID),
    hasSessionSecret: Boolean(process.env.SESSION_SECRET),
    hasS3Bucket: Boolean(process.env.S3_BUCKET),
    nodeEnv: process.env.NODE_ENV,
    awsRegion: process.env.AWS_REGION,
    lambdaFn: process.env.AWS_LAMBDA_FUNCTION_NAME,
  });
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const email = data?.email?.toString().trim().toLowerCase() || '';
    const password = data?.password?.toString() || '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const valid = await verifyCognitoCredentials(email, password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const { token, maxAge } = await createSessionToken(email);
    const response = NextResponse.json({ ok: true, email });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    return response;
  } catch (error) {
    // TEMP DIAGNOSTIC - remove before final commit
    return NextResponse.json(
      { error: 'debug', name: (error as Error)?.name, message: (error as Error)?.message, stack: (error as Error)?.stack },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
