import { NextRequest, NextResponse } from 'next/server';
import { updateMediaItem, withViewUrls } from '@/app/lib/media';
import { requireAdmin } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  await ensureConfigLoaded();
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const updates: {
    description?: string;
    hidden?: boolean;
    title?: string;
    location?: string;
    owner?: string;
    descriptionSource?: 'manual';
  } = {};

  if (typeof body?.description === 'string') {
    updates.description = body.description.trim();
    updates.descriptionSource = 'manual';
  }
  if (typeof body?.hidden === 'boolean') updates.hidden = body.hidden;
  if (typeof body?.title === 'string' && body.title.trim()) updates.title = body.title.trim();
  if (typeof body?.location === 'string' && body.location.trim()) updates.location = body.location.trim();
  if (typeof body?.owner === 'string' && body.owner.trim()) updates.owner = body.owner.trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const updated = await updateMediaItem(params.id, updates);
  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [withUrl] = await withViewUrls([updated]);
  return NextResponse.json(withUrl);
}
