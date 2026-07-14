import { NextRequest, NextResponse } from 'next/server';
import { generateDescription, saveMediaItem, saveUploadedFile, type MediaItem, type MediaType } from '@/app/lib/media';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const title = (formData.get('title') as string | null)?.trim() || 'Untitled';
    const description = (formData.get('description') as string | null)?.trim() || '';
    const type: MediaType = (formData.get('type') as string | null) === 'video' ? 'video' : 'photo';
    const location = (formData.get('location') as string | null)?.trim() || 'Hawaii';
    const latitude = formData.get('latitude') ? Number(formData.get('latitude')) : undefined;
    const longitude = formData.get('longitude') ? Number(formData.get('longitude')) : undefined;
    const owner = (formData.get('owner') as string | null)?.trim() || 'guest';
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const url = await saveUploadedFile(file, id);
    const aiDescription = description || (await generateDescription(title, type, location));

    const item: MediaItem = {
      id,
      title,
      description: aiDescription,
      type,
      location,
      latitude,
      longitude,
      createdAt: new Date().toISOString(),
      url,
      filename: file.name,
      owner,
    };

    await saveMediaItem(item);
    return NextResponse.json(item);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to save media' }, { status: 500 });
  }
}

export async function GET() {
  const { readMediaItems } = await import('@/app/lib/media');
  const items = await readMediaItems();
  return NextResponse.json(items);
}
