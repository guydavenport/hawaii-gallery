import { loadEnvConfig } from '@next/env';

const PROJECT_ROOT = process.cwd();
const CONCURRENCY = 4;

interface CliArgs {
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  return { dryRun: process.argv.slice(2).includes('--dry-run') };
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
  const { getObjectBuffer } = await import('../app/lib/s3');
  const { createAndUploadThumbnail } = await import('../app/lib/thumbnail');
  const { readMediaItems, saveMediaItem } = await import('../app/lib/media');

  const args = parseArgs();
  const items = await readMediaItems();
  const missing = items.filter((item) => item.type === 'video' && !item.thumbnailKey);

  console.log(`${items.length} total item(s), ${missing.length} video(s) missing a thumbnail.`);

  if (missing.length === 0) return;

  if (args.dryRun) {
    for (const item of missing) {
      console.log(`  [dry-run] ${item.filename} (${item.key})`);
    }
    return;
  }

  let done = 0;
  let failed = 0;

  await runPool(missing, CONCURRENCY, async (item) => {
    try {
      const buffer = await getObjectBuffer(item.key);
      const thumbnailKey = await createAndUploadThumbnail(item.key, buffer, item.type);
      if (!thumbnailKey) {
        failed++;
        console.warn(`  Thumbnail generation failed for ${item.filename}`);
        return;
      }
      await saveMediaItem({ ...item, thumbnailKey });
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${missing.length} done...`);
    } catch (error) {
      failed++;
      console.error(`  Failed for ${item.filename}:`, error);
    }
  });

  console.log(`Backfilled ${done} video thumbnail(s), ${failed} failure(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
