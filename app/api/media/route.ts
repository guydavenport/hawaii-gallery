import { NextRequest, NextResponse } from 'next/server';
import {
  generateDescription,
  inferTypeFromFilename,
  readMediaItems,
  saveMediaItems,
  visibleToRole,
  withViewUrls,
  type MediaItem,
  type MediaType,
} from '@/app/lib/media';
import { requireSession, requireAdmin } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';
import { getObjectBuffer, putObject } from '@/app/lib/s3';
import { createAndUploadThumbnail, createAndUploadDisplayVersion, generateThumbnailBuffer } from '@/app/lib/thumbnail';
import { matchFacesInPhoto } from '@/app/lib/faces';
import { embedCopyright } from '@/app/lib/copyright';

interface RegisterRequestItem {
  key: string;
  filename: string;
  title?: string;
  description?: string;
  location?: string;
  type?: MediaType;
  owner?: string;
  latitude?: number;
  longitude?: number;
}

export async function GET(request: NextRequest) {
  await ensureConfigLoaded();
  const session = await requireSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const items = await readMediaItems();
  const withUrls = await withViewUrls(visibleToRole(items, session.role));
  return NextResponse.json(withUrls);
}

export async function POST(request: NextRequest) {
  await ensureConfigLoaded();
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const rawItems: RegisterRequestItem[] = Array.isArray(body?.items)
      ? body.items
      : body?.key
      ? [body]
      : [];

    if (rawItems.length === 0) {
      return NextResponse.json({ error: 'No items provided' }, { status: 400 });
    }

    const mediaItems: MediaItem[] = await Promise.all(
      rawItems.map(async (raw) => {
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

        let description: string;
        let descriptionSource: MediaItem['descriptionSource'];
        if (raw.description?.trim()) {
          description = raw.description.trim();
          descriptionSource = 'manual';
        } else {
          const generated = await generateDescription(title, type, location, visionBuffer, people);
          description = generated.description;
          descriptionSource = generated.source;
        }

        const item: MediaItem = {
          id: crypto.randomUUID(),
          title,
          description,
          type,
          location,
          latitude: raw.latitude,
          longitude: raw.longitude,
          createdAt: new Date().toISOString(),
          key: raw.key,
          filename: raw.filename,
          owner,
          thumbnailKey,
          displayKey,
          people,
          descriptionSource,
        };
        return item;
      })
    );

    await saveMediaItems(mediaItems);
    const withUrls = await withViewUrls(mediaItems);
    return NextResponse.json(rawItems.length === 1 && !Array.isArray(body?.items) ? withUrls[0] : withUrls);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to save media' }, { status: 500 });
  }
}
