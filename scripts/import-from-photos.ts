import { execFileSync, spawnSync } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { MediaItem, MediaType } from '../app/lib/media';

const PROJECT_ROOT = process.cwd();
const OSXPHOTOS_BIN = path.join(PROJECT_ROOT, '.venv-photos', 'bin', 'osxphotos');
const STATE_PATH = path.join(PROJECT_ROOT, 'data', 'photo-import-state.json');
const STAGING_DIR = path.join(PROJECT_ROOT, '.photo-import-staging');

interface CliArgs {
  since?: string;
  until?: string;
  owner: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { owner: 'Guy', dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--date') {
      const date = args[++i];
      result.since = date;
      const next = new Date(`${date}T00:00:00`);
      next.setDate(next.getDate() + 1);
      result.until = next.toISOString().slice(0, 10);
    } else if (arg === '--since') {
      result.since = args[++i];
    } else if (arg === '--until') {
      result.until = args[++i];
    } else if (arg === '--owner') {
      result.owner = args[++i];
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return result;
}

interface ImportState {
  lastImportedCaptureDate?: string;
  pendingUuids?: string[];
}

async function readState(): Promise<ImportState> {
  try {
    const raw = await fsp.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeState(state: ImportState) {
  await fsp.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fsp.writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
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
  return execFileSync(OSXPHOTOS_BIN, args, {
    maxBuffer: 1024 * 1024 * 200,
    encoding: 'utf8',
  });
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
  const { createAndUploadThumbnail, createAndUploadDisplayVersion } = await import('../app/lib/thumbnail');

  const args = parseArgs();
  const state = await readState();

  const since = args.since || state.lastImportedCaptureDate?.slice(0, 10);
  if (!since) {
    console.error('No import history found. Pass --since YYYY-MM-DD or --date YYYY-MM-DD for the first run.');
    process.exit(1);
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const until = args.until || tomorrow.toISOString().slice(0, 10);

  console.log(`Querying Photos library from ${since} to ${until}...`);
  const queryJson = runOsxphotos(['query', '--json', '--from-date', since, '--to-date', until]);
  const records: PhotoRecord[] = JSON.parse(queryJson);

  const pendingUuids = state.pendingUuids || [];
  const rangeUuids = new Set(records.map((r) => r.uuid));
  const missingPending = pendingUuids.filter((uuid) => !rangeUuids.has(uuid));
  if (missingPending.length > 0) {
    console.log(`Re-checking ${missingPending.length} previously failed item(s) outside this date range...`);
    const pendingJson = runOsxphotos(['query', '--json', ...missingPending.flatMap((uuid) => ['--uuid', uuid])]);
    records.push(...(JSON.parse(pendingJson) as PhotoRecord[]));
  }

  const existingItems = await readMediaItems();
  const knownUuids = new Set(existingItems.map((item) => item.sourceUuid).filter(Boolean));
  const newRecords = records.filter((record) => !knownUuids.has(record.uuid));

  console.log(`Found ${records.length} item(s) in range, ${newRecords.length} not yet imported.`);

  if (newRecords.length === 0) {
    await writeState({ lastImportedCaptureDate: state.lastImportedCaptureDate, pendingUuids: [] });
    return;
  }

  if (args.dryRun) {
    for (const record of newRecords) {
      console.log(`  [dry-run] ${record.original_filename} — ${record.date_original || record.date} — ${locationLabel(record.place)}`);
    }
    return;
  }

  await fsp.mkdir(STAGING_DIR, { recursive: true });
  const uuids = newRecords.map((r) => r.uuid);

  console.log(`Exporting ${uuids.length} item(s) to staging directory (this may pause to download originals from iCloud)...`);
  runOsxphotosVisible([
    'export',
    STAGING_DIR,
    ...uuids.flatMap((uuid) => ['--uuid', uuid]),
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
  let maxCaptureDate = state.lastImportedCaptureDate || since;

  for (const record of newRecords) {
    const stagedName = pickStagedFile(stagedByUuid.get(record.uuid), record.ismovie);

    let fileBuffer: Buffer;
    try {
      if (!stagedName) throw new Error('not found');
      fileBuffer = await fsp.readFile(path.join(STAGING_DIR, stagedName));
    } catch {
      console.warn(`  Skipping ${record.original_filename}: export file not found in staging directory (will retry next run)`);
      stillMissingUuids.push(record.uuid);
      continue;
    }

    const ext = path.extname(stagedName).toLowerCase();
    const type: MediaType = record.ismovie ? 'video' : 'photo';
    const captureDate = record.date_original || record.date;
    const createdAt = new Date(captureDate).toISOString();
    const location = locationLabel(record.place);
    const filename = `${path.basename(record.original_filename, path.extname(record.original_filename))}${ext}`;
    const key = `uploads/${record.uuid}-${filename}`;

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

    const title = location;
    const description = record.ai_caption
      ? capitalize(record.ai_caption)
      : await generateDescription(title, type, location);

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
      sourceUuid: record.uuid,
    });

    if (createdAt > maxCaptureDate) {
      maxCaptureDate = createdAt;
    }
  }

  if (mediaItems.length > 0) {
    await saveMediaItems(mediaItems);
    console.log(`Imported ${mediaItems.length} new item(s) into the gallery.`);
  }
  if (stillMissingUuids.length > 0) {
    console.log(`${stillMissingUuids.length} item(s) still unavailable locally; will retry automatically next run.`);
  }

  await writeState({ lastImportedCaptureDate: maxCaptureDate, pendingUuids: stillMissingUuids });
  await fsp.rm(STAGING_DIR, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
