import { NextRequest, NextResponse } from 'next/server';
import { listAccessRequests } from '@/app/lib/access-requests';
import { requireAdmin } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function GET(request: NextRequest) {
  await ensureConfigLoaded();
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const requests = await listAccessRequests();
  return NextResponse.json(requests);
}
