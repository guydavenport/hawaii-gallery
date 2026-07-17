import { loadEnvConfig } from '@next/env';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const CONCURRENCY = 6;
// Hamming distance threshold out of 64 bits. Lower = stricter (fewer false
// positives, might miss real near-dupes); higher = looser.
const DISTANCE_THRESHOLD = 6;
const execFileAsync = promisify(execFile);

// 9x8 grayscale difference hash: compares each pixel to its right neighbor,
// robust to resizing/recompression (WhatsApp, different export pipelines)
// since it only cares about relative brightness gradients, not exact bytes.
async function dHash(buffer: Buffer): Promise<bigint | null> {
  try {
    const { data } = await sharp(buffer)
      .rotate()
      .resize(9, 8, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let hash = BigInt(0);
    const ONE = BigInt(1);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = data[row * 9 + col];
        const right = data[row * 9 + col + 1];
        hash = (hash << ONE) | (left < right ? ONE : BigInt(0));
      }
    }
    return hash;
  } catch {
    let tmpDir: string | undefined;
    try {
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'phash-'));
      const srcPath = path.join(tmpDir, 'src');
      const outPath = path.join(tmpDir, 'out.jpg');
      await fsp.writeFile(srcPath, buffer);
      await execFileAsync('sips', ['-s', 'format', 'jpeg', srcPath, '--out', outPath]);
      const jpeg = await fsp.readFile(outPath);
      return dHash(jpeg);
    } catch {
      return null;
    } finally {
      if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }
}

function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  const ONE = BigInt(1);
  while (x > BigInt(0)) {
    count += Number(x & ONE);
    x >>= ONE;
  }
  return count;
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

  const items = (await readMediaItems()).filter((i) => i.type === 'photo');
  console.log(`Hashing ${items.length} photo(s)...`);

  const hashByItemId = new Map<string, bigint>();
  let done = 0;
  let failed = 0;

  await runPool(items, CONCURRENCY, async (item) => {
    try {
      const buffer = await getObjectBuffer(item.key);
      const hash = await dHash(buffer);
      if (hash != null) hashByItemId.set(item.id, hash);
      else failed++;
    } catch (error) {
      failed++;
      console.error(`  Failed to hash ${item.filename}:`, error);
    }
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${items.length} hashed...`);
  });

  type Item = (typeof items)[number];
  const hashed = items.filter((i) => hashByItemId.has(i.id));

  // Report direct pairs, not transitive clusters: union-find over a chain of
  // burst photos (A~B~C~D, each close to its neighbor but A and D not
  // actually alike) merges them into one blob that looks like a match even
  // when the endpoints aren't similar at all.
  //
  // Also skip pairs where both sides have a sourceUuid: that means both
  // came from the same Photos-library export batch, which is exactly what
  // a burst sequence looks like -- multiple genuinely distinct frames taken
  // a second apart. A true redundant re-upload crosses import sources (one
  // side from Downloads/WhatsApp, or different owners), so require at least
  // one side to lack a sourceUuid.
  const pairs: { a: Item; b: Item; distance: number }[] = [];
  console.log(`Comparing ${hashed.length} items pairwise...`);
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      const a = hashed[i];
      const b = hashed[j];
      if (a.sourceUuid && b.sourceUuid) continue;
      const distance = hammingDistance(hashByItemId.get(a.id)!, hashByItemId.get(b.id)!);
      if (distance <= DISTANCE_THRESHOLD) {
        pairs.push({ a, b, distance });
      }
    }
  }

  pairs.sort((x, y) => x.distance - y.distance);
  console.log(`\n${pairs.length} candidate pair(s) (${failed} hash failures).`);

  const output = pairs.map(({ a, b, distance }) =>
    [a, b]
      .slice()
      .sort((x: Item, y: Item) => x.createdAt.localeCompare(y.createdAt))
      .map((i: Item) => ({
        id: i.id,
        key: i.key,
        filename: i.filename,
        owner: i.owner,
        createdAt: i.createdAt,
        title: i.title,
        distance,
        hasThumbnail: !!i.thumbnailKey,
        hasPeople: (i.people || []).length,
        descriptionSource: i.descriptionSource,
        sourceUuid: i.sourceUuid,
        hidden: !!i.hidden,
      }))
  );

  await fsp.writeFile(
    path.join(PROJECT_ROOT, 'data', 'near-duplicate-clusters.json'),
    JSON.stringify(output, null, 2) + '\n',
    'utf8'
  );
  console.log('Wrote full pair details to data/near-duplicate-clusters.json');

  for (const pair of output) {
    console.log(`--- distance ${pair[0].distance} ---`);
    for (const i of pair) {
      console.log(`  ${i.createdAt} | ${i.filename} | owner=${i.owner} | title="${i.title}" | sourceUuid=${!!i.sourceUuid}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
