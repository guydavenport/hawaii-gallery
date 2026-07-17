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
const DISPLAY_QUALITY = 88;
// Rekognition rejects images over 5MB; 1920px wide keeps faces detectable
// while comfortably staying under that limit.
const REKOGNITION_MAX_WIDTH = 1920;
const REKOGNITION_QUALITY = 85;

export const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

// sharp's bundled libvips can't decode HEIC (patent-encumbered HEVC codec is
// excluded from the prebuilt binaries). Fall back to macOS's built-in `sips`,
// which handles HEIC fine — only available when running locally on a Mac
// (the CLI import scripts), never in the Lambda/Linux production runtime, so
// this is a no-op there and callers should keep treating `null` as normal.
async function convertViaSips(input: Buffer, quality: number, width?: number): Promise<Buffer | null> {
  let tmpDir: string | undefined;
  try {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
    const srcPath = path.join(tmpDir, 'src');
    const outPath = path.join(tmpDir, 'out.jpg');
    await fsp.writeFile(srcPath, input);
    const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality)];
    if (width) args.push('--resampleWidth', String(width));
    args.push(srcPath, '--out', outPath);
    await execFileAsync('sips', args);
    return await fsp.readFile(outPath);
  } catch {
    return null;
  } finally {
    if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

async function convertToJpeg(input: Buffer, quality: number, width?: number): Promise<Buffer | null> {
  try {
    let pipeline = sharp(input).rotate();
    if (width) pipeline = pipeline.resize({ width, withoutEnlargement: true });
    return await pipeline.jpeg({ quality }).toBuffer();
  } catch {
    return convertViaSips(input, quality, width);
  }
}

export async function generateThumbnailBuffer(input: Buffer): Promise<Buffer | null> {
  return convertToJpeg(input, THUMBNAIL_QUALITY, THUMBNAIL_WIDTH);
}

// Full-resolution JPEG, used only as a browser-viewable stand-in for source
// formats (HEIC/HEIF) that most browsers can't decode in an <img> tag.
export async function generateDisplayBuffer(input: Buffer): Promise<Buffer | null> {
  return convertToJpeg(input, DISPLAY_QUALITY);
}

// JPEG sized for Rekognition (handles both the 5MB API limit and HEIC
// sources, which Rekognition can't accept directly).
export async function generateRekognitionBuffer(input: Buffer): Promise<Buffer | null> {
  return convertToJpeg(input, REKOGNITION_QUALITY, REKOGNITION_MAX_WIDTH);
}

// Lives under a separate top-level prefix (not /uploads/) so it's never
// picked up by the "Sync with S3" scan, which lists everything under /uploads/.
export function thumbnailKeyFor(key: string): string {
  const name = key.slice(key.lastIndexOf('/') + 1);
  return `thumbnails/${name.replace(/\.[^.]+$/, '')}.jpg`;
}

export function displayKeyFor(key: string): string {
  const name = key.slice(key.lastIndexOf('/') + 1);
  return `display/${name.replace(/\.[^.]+$/, '')}.jpg`;
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

/**
 * For photo sources most browsers can't render inline (HEIC/HEIF), generates
 * a full-resolution JPEG stand-in for lightbox display. Returns undefined for
 * already-web-safe formats (JPEG/PNG/etc.) — those use the original directly.
 */
export async function createAndUploadDisplayVersion(
  key: string,
  buffer: Buffer,
  type: 'photo' | 'video'
): Promise<string | undefined> {
  if (type !== 'photo') return undefined;
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  if (!HEIC_EXTENSIONS.has(ext)) return undefined;
  const displayBuffer = await generateDisplayBuffer(buffer);
  if (!displayBuffer) return undefined;
  const displayKey = displayKeyFor(key);
  await putObject(displayKey, displayBuffer, 'image/jpeg');
  return displayKey;
}
