import { NextRequest, NextResponse } from 'next/server';
import { buildUploadKey, createUploadUrl } from '@/app/lib/s3';

interface PresignRequestItem {
  filename: string;
  contentType: string;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const files: PresignRequestItem[] = Array.isArray(body?.files) ? body.files : [];

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  const results = await Promise.all(
    files.map(async ({ filename, contentType }) => {
      const id = crypto.randomUUID();
      const key = buildUploadKey(id, filename);
      const uploadUrl = await createUploadUrl(key, contentType || 'application/octet-stream');
      return { id, filename, key, uploadUrl };
    })
  );

  return NextResponse.json({ files: results });
}
