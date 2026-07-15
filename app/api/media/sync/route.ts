import { NextRequest, NextResponse } from 'next/server';
import { listUploadedObjects } from '@/app/lib/s3';
import {
  generateDescription,
  inferTypeFromFilename,
  readMediaItems,
  writeMediaItems,
  type MediaItem,
  type MediaType,
} from '@/app/lib/media';
import { requireSession } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

function filenameFromKey(key: string) {
  const withoutPrefix = key.split('/').pop() || key;
  const dashIndex = withoutPrefix.indexOf('-');
  return dashIndex >= 0 ? withoutPrefix.slice(dashIndex + 1) : withoutPrefix;
}

export async function GET(request: NextRequest) {
  await ensureConfigLoaded();
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [items, objects] = await Promise.all([readMediaItems(), listUploadedObjects()]);

  const knownKeys = new Set(items.map((item) => item.key));
  const objectKeys = new Set(objects.map((object) => object.key));

  const toAdd = objects
    .filter((object) => !knownKeys.has(object.key))
    .map((object) => ({
      key: object.key,
      filename: filenameFromKey(object.key),
      size: object.size,
      lastModified: object.lastModified,
      suggestedTitle: filenameFromKey(object.key).replace(/\.[^.]+$/, ''),
      suggestedType: inferTypeFromFilename(object.key),
    }));

  const toRemove = items
    .filter((item) => !objectKeys.has(item.key))
    .map((item) => ({ id: item.id, key: item.key, title: item.title }));

  return NextResponse.json({ toAdd, toRemove });
}

interface ApplyAddItem {
  key: string;
  filename: string;
  title?: string;
  location?: string;
  type?: MediaType;
  owner?: string;
}

export async function POST(request: NextRequest) {
  await ensureConfigLoaded();
  if (!(await requireSession(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const addItems: ApplyAddItem[] = Array.isArray(body?.add) ? body.add : [];
  const removeIds: string[] = Array.isArray(body?.removeIds) ? body.removeIds : [];

  const items = await readMediaItems();

  const newItems: MediaItem[] = await Promise.all(
    addItems.map(async (raw) => {
      const title = raw.title?.trim() || raw.filename || 'Untitled';
      const type = raw.type || inferTypeFromFilename(raw.filename);
      const location = raw.location?.trim() || 'Hawaii';
      const owner = raw.owner?.trim() || 'guest';
      const description = await generateDescription(title, type, location);

      return {
        id: crypto.randomUUID(),
        title,
        description,
        type,
        location,
        createdAt: new Date().toISOString(),
        key: raw.key,
        filename: raw.filename,
        owner,
      };
    })
  );

  const removeIdSet = new Set(removeIds);
  const remaining = items.filter((item) => !removeIdSet.has(item.id));
  const finalItems = [...newItems, ...remaining];

  await writeMediaItems(finalItems);

  return NextResponse.json({ added: newItems.length, removed: items.length - remaining.length });
}
