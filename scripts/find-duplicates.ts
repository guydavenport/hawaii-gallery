import { loadEnvConfig } from '@next/env';
import crypto from 'crypto';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const CONCURRENCY = 6;
const execFileAsync = promisify(execFile);

async function decodeToRawHash(buffer: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(buffer).rotate().raw().toBuffer({ resolveWithObject: true });
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    // HEIC etc. -- fall back to sips (macOS only, this script runs locally).
    let tmpDir: string | undefined;
    try {
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'duphash-'));
      const srcPath = path.join(tmpDir, 'src');
      const outPath = path.join(tmpDir, 'out.jpg');
      await fsp.writeFile(srcPath, buffer);
      await execFileAsync('sips', ['-s', 'format', 'jpeg', srcPath, '--out', outPath]);
      const jpeg = await fsp.readFile(outPath);
      const { data } = await sharp(jpeg).rotate().raw().toBuffer({ resolveWithObject: true });
      return crypto.createHash('sha256').update(data).digest('hex');
    } catch {
      return null;
    } finally {
      if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  async function next(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index], index);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { readMediaItems } = await import('../app/lib/media');
  const { getObjectBuffer } = await import('../app/lib/s3');

  const items = await readMediaItems();
  console.log(`Hashing ${items.length} item(s)...`);

  const hashByItemId = new Map<string, string>();
  let done = 0;
  let failed = 0;

  await runPool(items, CONCURRENCY, async (item) => {
    try {
      const buffer = await getObjectBuffer(item.key);
      const hash =
        item.type === 'photo'
          ? await decodeToRawHash(buffer)
          : crypto.createHash('sha256').update(buffer).digest('hex');
      if (hash) hashByItemId.set(item.id, hash);
      else failed++;
    } catch (error) {
      failed++;
      console.error(`  Failed to hash ${item.filename}:`, error);
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${items.length} hashed...`);
  });

  type Item = (typeof items)[number];
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const hash = hashByItemId.get(item.id);
    if (!hash) continue;
    const group = groups.get(hash) || [];
    group.push(item);
    groups.set(hash, group);
  }

  const dupGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  const totalDupItems = dupGroups.reduce((sum, g) => sum + g.length - 1, 0);

  console.log(`\n${dupGroups.length} duplicate group(s) found, ${totalDupItems} redundant item(s) (${failed} hash failures).`);
  console.log(JSON.stringify({ groups: dupGroups.length, redundant: totalDupItems, failed }));

  const output = dupGroups.map((group) =>
    group
      .slice()
      .sort((a: Item, b: Item) => a.createdAt.localeCompare(b.createdAt))
      .map((i: Item) => ({
        id: i.id,
        filename: i.filename,
        owner: i.owner,
        createdAt: i.createdAt,
        hasThumbnail: !!i.thumbnailKey,
        hasPeople: (i.people || []).length,
        descriptionSource: i.descriptionSource,
        sourceUuid: i.sourceUuid,
        hidden: !!i.hidden,
      }))
  );

  await fsp.writeFile(
    path.join(PROJECT_ROOT, 'data', 'duplicate-groups.json'),
    JSON.stringify(output, null, 2) + '\n',
    'utf8'
  );
  console.log('Wrote full group details to data/duplicate-groups.json');

  for (const group of output.slice(0, 20)) {
    console.log('---');
    for (const i of group) {
      console.log(`  ${i.createdAt} | ${i.filename} | owner=${i.owner} | thumb=${i.hasThumbnail} people=${i.hasPeople} hidden=${i.hidden}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
