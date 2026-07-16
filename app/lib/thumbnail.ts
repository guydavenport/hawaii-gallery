import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { putObject } from '@/app/lib/s3';

const execFileAsync = promisify(execFile);

const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_QUALITY = 70;

// sharp's bundled libvips can't decode HEIC (patent-encumbered HEVC codec is
// excluded from the prebuilt binaries). Fall back to macOS's built-in `sips`,
// which handles HEIC fine — only available when running locally on a Mac
// (the CLI import scripts), never in the Lambda/Linux production runtime, so
// this is a no-op there and callers should keep treating `null` as normal.
async function generateThumbnailViaSips(input: Buffer): Promise<Buffer | null> {
  let tmpDir: string | undefined;
  try {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
    const srcPath = path.join(tmpDir, 'src');
    const outPath = path.join(tmpDir, 'out.jpg');
    await fsp.writeFile(srcPath, input);
    await execFileAsync('sips', [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(THUMBNAIL_QUALITY),
      '--resampleWidth', String(THUMBNAIL_WIDTH),
      srcPath,
      '--out', outPath,
    ]);
    return await fsp.readFile(outPath);
  } catch {
    return null;
  } finally {
    if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function generateThumbnailBuffer(input: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(input)
      .rotate()
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toBuffer();
  } catch {
    return generateThumbnailViaSips(input);
  }
}

// Lives under a separate top-level prefix (not /uploads/) so it's never
// picked up by the "Sync with S3" scan, which lists everything under /uploads/.
export function thumbnailKeyFor(key: string): string {
  const name = key.slice(key.lastIndexOf('/') + 1);
  return `thumbnails/${name.replace(/\.[^.]+$/, '')}.jpg`;
}

/** Generates a thumbnail from a photo buffer and uploads it; returns the key, or undefined if it's a video or generation failed. */
export async function createAndUploadThumbnail(
  key: string,
  buffer: Buffer,
  type: 'photo' | 'video'
): Promise<string | undefined> {
  if (type !== 'photo') return undefined;
  const thumbBuffer = await generateThumbnailBuffer(buffer);
  if (!thumbBuffer) return undefined;
  const thumbKey = thumbnailKeyFor(key);
  await putObject(thumbKey, thumbBuffer, 'image/jpeg');
  return thumbKey;
}
