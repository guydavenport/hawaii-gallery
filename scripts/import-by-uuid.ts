import { execFileSync, spawnSync } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { MediaItem, MediaType } from '../app/lib/media';

const PROJECT_ROOT = process.cwd();
const OSXPHOTOS_BIN = path.join(PROJECT_ROOT, '.venv-photos', 'bin', 'osxphotos');
const STAGING_DIR = path.join(PROJECT_ROOT, '.photo-import-staging');

interface CliArgs {
  owner: string;
  uuidFile: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { owner: 'Guest', uuidFile: '', dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--owner') result.owner = args[++i];
    else if (args[i] === '--uuid-file') result.uuidFile = args[++i];
    else if (args[i] === '--dry-run') result.dryRun = true;
    else {
      console.error(`Unknown argument: ${args[i]}`);
      process.exit(1);
    }
  }
  if (!result.uuidFile) {
    console.error('Usage: import-by-uuid.ts --owner <name> --uuid-file <path> [--dry-run]');
    process.exit(1);
  }
  return result;
}

interface PlaceInfo {
  name?: string;
  address?: { city?: string };
  names?: { area_of_interest?: string[] };
}

interface PhotoRecord {
  uuid: string;
  original_filename: string;
  date_original: string | null;
  date: string;
  ismovie: boolean;
  ai_caption: string | null;
  place: PlaceInfo | null;
  latitude: number | null;
  longitude: number | null;
}

function runOsxphotos(args: string[]) {
  return execFileSync(OSXPHOTOS_BIN, args, { maxBuffer: 1024 * 1024 * 200, encoding: 'utf8' });
}

function runOsxphotosVisible(args: string[]) {
  const result = spawnSync(OSXPHOTOS_BIN, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`osxphotos ${args[0]} exited with status ${result.status}`);
  }
}

function locationLabel(place: PlaceInfo | null): string {
  if (!place) return 'Hawaii';
  return place.names?.area_of_interest?.[0] || place.address?.city || place.name || 'Hawaii';
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.mov':
      return 'video/quicktime';
    case '.mp4':
      return 'video/mp4';
    case '.m4v':
      return 'video/x-m4v';
    default:
      return 'application/octet-stream';
  }
}

const VIDEO_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v']);

// Live Photos export both a still image and a paired .mov motion clip
// under the same uuid prefix - pick the one matching the expected type.
function pickStagedFile(candidates: string[] | undefined, ismovie: boolean): string | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const match = candidates.find((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()) === ismovie);
  return match || candidates[0];
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { s3Client, getBucket } = await import('../app/lib/s3');
  const { generateDescription, saveMediaItems, readMediaItems } = await import('../app/lib/media');
  const { createAndUploadThumbnail, createAndUploadDisplayVersion, generateThumbnailBuffer } = await import(
    '../app/lib/thumbnail'
  );
  const { reverseGeocode } = await import('../app/lib/geocode');
  const { matchFacesInPhoto } = await import('../app/lib/faces');
  const { embedCopyright } = await import('../app/lib/copyright');

  const args = parseArgs();
  const uuids = (await fsp.readFile(args.uuidFile, 'utf8'))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Loaded ${uuids.length} uuid(s) from ${args.uuidFile}.`);

  const queryJson = runOsxphotos(['query', '--json', ...uuids.flatMap((uuid) => ['--uuid', uuid])]);
  const records: PhotoRecord[] = JSON.parse(queryJson);

  const existingItems = await readMediaItems();
  const knownUuids = new Set(existingItems.map((item) => item.sourceUuid).filter(Boolean));
  const newRecords = records.filter((record) => !knownUuids.has(record.uuid));

  console.log(`${records.length} record(s) resolved, ${newRecords.length} not yet imported.`);

  if (newRecords.length === 0) return;

  if (args.dryRun) {
    for (const record of newRecords) {
      console.log(`  [dry-run] ${record.original_filename} — ${record.date_original || record.date} — ${locationLabel(record.place)}`);
    }
    return;
  }

  await fsp.mkdir(STAGING_DIR, { recursive: true });
  const exportUuids = newRecords.map((r) => r.uuid);

  console.log(`Exporting ${exportUuids.length} item(s) to staging directory (this may pause to download originals from iCloud)...`);
  runOsxphotosVisible([
    'export',
    STAGING_DIR,
    ...exportUuids.flatMap((uuid) => ['--uuid', uuid]),
    '--convert-to-jpeg',
    '--jpeg-quality',
    '0.9',
    '--filename',
    '{uuid}',
    '--download-missing',
    '--update',
  ]);

  const stagedFiles = await fsp.readdir(STAGING_DIR);
  const stagedByUuid = new Map<string, string[]>();
  for (const name of stagedFiles) {
    const dotIndex = name.indexOf('.');
    if (dotIndex === -1) continue;
    const uuid = name.slice(0, dotIndex);
    const list = stagedByUuid.get(uuid) || [];
    list.push(name);
    stagedByUuid.set(uuid, list);
  }

  const mediaItems: MediaItem[] = [];
  const stillMissingUuids: string[] = [];

  for (const record of newRecords) {
    const stagedName = pickStagedFile(stagedByUuid.get(record.uuid), record.ismovie);

    let fileBuffer: Buffer;
    try {
      if (!stagedName) throw new Error('not found');
      fileBuffer = await fsp.readFile(path.join(STAGING_DIR, stagedName));
    } catch {
      console.warn(`  Skipping ${record.original_filename}: export file not found in staging directory`);
      stillMissingUuids.push(record.uuid);
      continue;
    }

    const ext = path.extname(stagedName).toLowerCase();
    const type: MediaType = record.ismovie ? 'video' : 'photo';
    const captureDate = record.date_original || record.date;
    const createdAt = new Date(captureDate).toISOString();
    let location = locationLabel(record.place);
    if (location === 'Hawaii' && record.latitude != null && record.longitude != null) {
      const geocoded = await reverseGeocode(record.latitude, record.longitude);
      if (geocoded) location = geocoded;
    }
    const filename = `${path.basename(record.original_filename, path.extname(record.original_filename))}${ext}`;
    const key = `uploads/${record.uuid}-${filename}`;

    if (type === 'photo') {
      fileBuffer = embedCopyright(fileBuffer, args.owner);
    }

    console.log(`  Uploading ${filename} -> s3://${getBucket()}/${key}`);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: fileBuffer,
        ContentType: contentTypeFor(ext),
      })
    );
    const thumbnailKey = await createAndUploadThumbnail(key, fileBuffer, type);
    const displayKey = await createAndUploadDisplayVersion(key, fileBuffer, type);
    const people = type === 'photo' ? await matchFacesInPhoto(fileBuffer) : undefined;

    const title = location;
    let description: string;
    let descriptionSource: MediaItem['descriptionSource'];
    if (record.ai_caption) {
      description = capitalize(record.ai_caption);
      descriptionSource = 'vision';
    } else {
      const generated = await generateDescription(
        title,
        type,
        location,
        (await generateThumbnailBuffer(fileBuffer)) ?? undefined,
        people
      );
      description = generated.description;
      descriptionSource = generated.source;
    }

    mediaItems.push({
      id: crypto.randomUUID(),
      title,
      description,
      type,
      location,
      latitude: record.latitude ?? undefined,
      longitude: record.longitude ?? undefined,
      createdAt,
      key,
      filename,
      owner: args.owner,
      thumbnailKey,
      displayKey,
      people,
      descriptionSource,
      sourceUuid: record.uuid,
    });
  }

  if (mediaItems.length > 0) {
    await saveMediaItems(mediaItems);
    console.log(`Imported ${mediaItems.length} new item(s) into the gallery.`);
  }
  if (stillMissingUuids.length > 0) {
    console.log(`${stillMissingUuids.length} item(s) still unavailable locally. UUIDs:`);
    console.log(stillMissingUuids.join('\n'));
  }

  await fsp.rm(STAGING_DIR, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
