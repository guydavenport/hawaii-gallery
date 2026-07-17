import { NextRequest, NextResponse } from 'next/server';
import { listUploadedObjects, getObjectBuffer, putObject } from '@/app/lib/s3';
import { createAndUploadThumbnail, createAndUploadDisplayVersion, generateThumbnailBuffer } from '@/app/lib/thumbnail';
import { matchFacesInPhoto } from '@/app/lib/faces';
import { embedCopyright } from '@/app/lib/copyright';
import {
  deleteMediaItems,
  generateDescription,
  inferTypeFromFilename,
  readMediaItems,
  saveMediaItems,
  type MediaItem,
  type MediaType,
} from '@/app/lib/media';
import { requireAdmin } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';

function filenameFromKey(key: string) {
  const withoutPrefix = key.split('/').pop() || key;
  const dashIndex = withoutPrefix.indexOf('-');
  return dashIndex >= 0 ? withoutPrefix.slice(dashIndex + 1) : withoutPrefix;
}

export async function GET(request: NextRequest) {
  await ensureConfigLoaded();
  if (!(await requireAdmin(request))) {
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
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const addItems: ApplyAddItem[] = Array.isArray(body?.add) ? body.add : [];
  const removeIds: string[] = Array.isArray(body?.removeIds) ? body.removeIds : [];

  const newItems: MediaItem[] = await Promise.all(
    addItems.map(async (raw) => {
      const title = raw.title?.trim() || raw.filename || 'Untitled';
      const type = raw.type || inferTypeFromFilename(raw.filename);
      const location = raw.location?.trim() || 'Hawaii';
      const owner = raw.owner?.trim() || 'guest';

      let thumbnailKey: string | undefined;
      let displayKey: string | undefined;
      let visionBuffer: Buffer | undefined;
      let people: string[] | undefined;
      try {
        let buffer = await getObjectBuffer(raw.key);
        if (type === 'photo') {
          const copyrighted = embedCopyright(buffer, owner);
          if (copyrighted !== buffer) {
            await putObject(raw.key, copyrighted, 'image/jpeg');
            buffer = copyrighted;
          }
        }
        thumbnailKey = await createAndUploadThumbnail(raw.key, buffer, type);
        displayKey = await createAndUploadDisplayVersion(raw.key, buffer, type);
        visionBuffer = (await generateThumbnailBuffer(buffer)) ?? undefined;
        if (type === 'photo') {
          people = await matchFacesInPhoto(buffer);
        }
      } catch (thumbError) {
        console.error('Thumbnail generation failed for', raw.key, thumbError);
      }

      const { description, source: descriptionSource } = await generateDescription(
        title,
        type,
        location,
        visionBuffer,
        people
      );

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
        thumbnailKey,
        displayKey,
        people,
        descriptionSource,
      };
    })
  );

  await saveMediaItems(newItems);
  await deleteMediaItems(removeIds);

  return NextResponse.json({ added: newItems.length, removed: removeIds.length });
}
