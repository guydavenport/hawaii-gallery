import { execFileSync } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';
import { loadEnvConfig } from '@next/env';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { MediaItem, MediaType } from '../app/lib/media';

const PROJECT_ROOT = process.cwd();
const HAWAII_OFFSET = '-10:00';

interface CliArgs {
  owner: string;
  location: string;
  dryRun: boolean;
  pattern?: RegExp;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { owner: 'Guest', location: 'Hawaii', dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--owner') result.owner = args[++i];
    else if (args[i] === '--location') result.location = args[++i];
    else if (args[i] === '--dry-run') result.dryRun = true;
    else if (args[i] === '--pattern') result.pattern = new RegExp(args[++i]);
    else {
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(1);
    }
  }
  return result;
}

interface ParsedFile {
  createdAt: string;
  type: MediaType;
  ext: string;
  latitude?: number;
  longitude?: number;
}

const WHATSAPP_PATTERN = /^WhatsApp (Image|Video) (\d{4}-\d{2}-\d{2}) at (\d{2})\.(\d{2})\.(\d{2})(?:\s*\((\d+)\))?\.(\w+)$/i;
const MEDIA_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'mp4', 'mov', 'm4v']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v']);

function parseWhatsAppFilename(filename: string): ParsedFile | null {
  const match = filename.match(WHATSAPP_PATTERN);
  if (!match) return null;
  const [, kind, date, hh, mm, ss, , ext] = match;
  const createdAt = new Date(`${date}T${hh}:${mm}:${ss}${HAWAII_OFFSET}`).toISOString();
  const type: MediaType = kind.toLowerCase() === 'video' ? 'video' : 'photo';
  return { createdAt, type, ext: ext.toLowerCase() };
}

function readExifMetadata(filePath: string): { createdAt: string | null; latitude?: number; longitude?: number } {
  try {
    const raw = execFileSync(
      'mdls',
      ['-name', 'kMDItemContentCreationDate', '-name', 'kMDItemLatitude', '-name', 'kMDItemLongitude', filePath],
      { encoding: 'utf8' }
    );
    const dateMatch = raw.match(/kMDItemContentCreationDate\s*=\s*(.+)/);
    const latMatch = raw.match(/kMDItemLatitude\s*=\s*(-?[\d.]+)/);
    const lonMatch = raw.match(/kMDItemLongitude\s*=\s*(-?[\d.]+)/);

    const createdAt =
      dateMatch && !dateMatch[1].includes('(null)') ? new Date(dateMatch[1].trim()).toISOString() : null;
    const latitude = latMatch ? Number(latMatch[1]) : undefined;
    const longitude = lonMatch ? Number(lonMatch[1]) : undefined;

    return { createdAt, latitude, longitude };
  } catch {
    return { createdAt: null };
  }
}

async function parseGenericFile(filePath: string, filename: string): Promise<ParsedFile | null> {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(ext)) return null;

  const exif = readExifMetadata(filePath);
  const stat = await fsp.stat(filePath);
  const createdAt = exif.createdAt || stat.mtime.toISOString();
  const type: MediaType = VIDEO_EXTENSIONS.has(ext) ? 'video' : 'photo';

  return { createdAt, type, ext, latitude: exif.latitude, longitude: exif.longitude };
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'heic':
      return 'image/heic';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'm4v':
      return 'video/x-m4v';
    default:
      return 'application/octet-stream';
  }
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { s3Client, getBucket } = await import('../app/lib/s3');
  const { generateDescription, saveMediaItems, readMediaItems } = await import('../app/lib/media');
  const { createAndUploadThumbnail, createAndUploadDisplayVersion, generateThumbnailBuffer } = await import(
    '../app/lib/thumbnail'
  );
  const { reverseGeocode } = await import('../app/lib/geocode');

  const args = parseArgs();
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const entries = await fsp.readdir(downloadsDir);

  const candidates: { filename: string; parsed: ParsedFile }[] = [];
  for (const filename of entries) {
    if (args.pattern && !args.pattern.test(filename)) continue;
    const whatsapp = parseWhatsAppFilename(filename);
    if (whatsapp) {
      candidates.push({ filename, parsed: whatsapp });
      continue;
    }
    const generic = await parseGenericFile(path.join(downloadsDir, filename), filename);
    if (generic) candidates.push({ filename, parsed: generic });
  }

  console.log(`Found ${candidates.length} media file(s) in ~/Downloads.`);

  const existingItems = await readMediaItems();
  const knownFilenames = new Set(existingItems.map((item) => item.filename));
  const newCandidates = candidates.filter((c) => !knownFilenames.has(c.filename));

  console.log(`${newCandidates.length} not yet imported.`);

  if (newCandidates.length === 0) return;

  if (args.dryRun) {
    for (const c of newCandidates) {
      const gps = c.parsed.latitude != null ? ` — gps: ${c.parsed.latitude},${c.parsed.longitude}` : ' — no gps';
      console.log(`  [dry-run] ${c.filename} — ${c.parsed.createdAt} — ${c.parsed.type}${gps}`);
    }
    return;
  }

  const mediaItems: MediaItem[] = [];

  for (const c of newCandidates) {
    const filePath = path.join(downloadsDir, c.filename);
    const buffer = await fsp.readFile(filePath);
    const id = crypto.randomUUID();
    const safeName = c.filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    const key = `uploads/${id}-${safeName}`;

    console.log(`  Uploading ${c.filename} -> s3://${getBucket()}/${key}`);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: buffer,
        ContentType: contentTypeFor(c.parsed.ext),
      })
    );
    const thumbnailKey = await createAndUploadThumbnail(key, buffer, c.parsed.type);
    const displayKey = await createAndUploadDisplayVersion(key, buffer, c.parsed.type);

    let location = args.location;
    if (location === 'Hawaii' && c.parsed.latitude != null && c.parsed.longitude != null) {
      const geocoded = await reverseGeocode(c.parsed.latitude, c.parsed.longitude);
      if (geocoded) location = geocoded;
    }
    const title = location;
    const description = await generateDescription(
      title,
      c.parsed.type,
      location,
      (await generateThumbnailBuffer(buffer)) ?? undefined
    );

    mediaItems.push({
      id,
      title,
      description,
      type: c.parsed.type,
      location,
      latitude: c.parsed.latitude,
      longitude: c.parsed.longitude,
      createdAt: c.parsed.createdAt,
      key,
      filename: c.filename,
      owner: args.owner,
      thumbnailKey,
      displayKey,
    });
  }

  await saveMediaItems(mediaItems);
  console.log(`Imported ${mediaItems.length} new item(s) into the gallery.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
