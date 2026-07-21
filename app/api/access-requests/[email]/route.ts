import { NextRequest, NextResponse } from 'next/server';
import { decideAccessRequest } from '@/app/lib/access-requests';
import { requireAdmin } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function PATCH(request: NextRequest, { params }: { params: { email: string } }) {
  await ensureConfigLoaded();
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const status = body?.status;
  if (status !== 'approved' && status !== 'denied') {
    return NextResponse.json({ error: 'status must be "approved" or "denied"' }, { status: 400 });
  }
  const role = body?.role === 'admin' ? 'admin' : 'guest';

  const updated = await decideAccessRequest(decodeURIComponent(params.email), status, role);
  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}
