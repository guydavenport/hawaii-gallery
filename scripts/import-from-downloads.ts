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
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { owner: 'Guest', location: 'Hawaii', dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--owner') result.owner = args[++i];
    else if (args[i] === '--location') result.location = args[++i];
    else if (args[i] === '--dry-run') result.dryRun = true;
    else {
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(1);
    }
  }
  return result;
}

const NAME_PATTERN = /^WhatsApp (Image|Video) (\d{4}-\d{2}-\d{2}) at (\d{2})\.(\d{2})\.(\d{2})(?:\s*\((\d+)\))?\.(\w+)$/i;

function parseFilename(filename: string) {
  const match = filename.match(NAME_PATTERN);
  if (!match) return null;
  const [, kind, date, hh, mm, ss, , ext] = match;
  const createdAt = new Date(`${date}T${hh}:${mm}:${ss}${HAWAII_OFFSET}`).toISOString();
  const type: MediaType = kind.toLowerCase() === 'video' ? 'video' : 'photo';
  return { createdAt, type, ext: ext.toLowerCase() };
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    default:
      return 'application/octet-stream';
  }
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { s3Client, getBucket } = await import('../app/lib/s3');
  const { generateDescription, saveMediaItems, readMediaItems } = await import('../app/lib/media');

  const args = parseArgs();
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const entries = await fsp.readdir(downloadsDir);

  const candidates = entries
    .map((filename) => ({ filename, parsed: parseFilename(filename) }))
    .filter((entry): entry is { filename: string; parsed: NonNullable<ReturnType<typeof parseFilename>> } => entry.parsed !== null);

  console.log(`Found ${candidates.length} WhatsApp-named file(s) in ~/Downloads.`);

  const existingItems = await readMediaItems();
  const knownFilenames = new Set(existingItems.map((item) => item.filename));
  const newCandidates = candidates.filter((c) => !knownFilenames.has(c.filename));

  console.log(`${newCandidates.length} not yet imported.`);

  if (newCandidates.length === 0) return;

  if (args.dryRun) {
    for (const c of newCandidates) {
      console.log(`  [dry-run] ${c.filename} — ${c.parsed.createdAt} — ${c.parsed.type}`);
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

    const title = args.location;
    const description = await generateDescription(title, c.parsed.type, args.location);

    mediaItems.push({
      id,
      title,
      description,
      type: c.parsed.type,
      location: args.location,
      createdAt: c.parsed.createdAt,
      key,
      filename: c.filename,
      owner: args.owner,
    });
  }

  await saveMediaItems(mediaItems);
  console.log(`Imported ${mediaItems.length} new item(s) into the gallery.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
