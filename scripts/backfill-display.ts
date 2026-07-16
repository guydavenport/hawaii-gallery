import { loadEnvConfig } from '@next/env';

const PROJECT_ROOT = process.cwd();
const CONCURRENCY = 6;
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

interface CliArgs {
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return { dryRun: args.includes('--dry-run') };
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

function extOf(key: string): string {
  return key.slice(key.lastIndexOf('.')).toLowerCase();
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { getObjectBuffer } = await import('../app/lib/s3');
  const { createAndUploadDisplayVersion } = await import('../app/lib/thumbnail');
  const { readMediaItems, saveMediaItem } = await import('../app/lib/media');

  const args = parseArgs();
  const items = await readMediaItems();
  const missing = items.filter(
    (item) => item.type === 'photo' && !item.displayKey && HEIC_EXTENSIONS.has(extOf(item.key))
  );

  console.log(`${items.length} total item(s), ${missing.length} HEIC photo(s) missing a display version.`);

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
      const displayKey = await createAndUploadDisplayVersion(item.key, buffer, item.type);
      if (!displayKey) {
        failed++;
        console.warn(`  Display version generation returned nothing for ${item.filename}`);
        return;
      }
      await saveMediaItem({ ...item, displayKey });
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${missing.length} done...`);
    } catch (error) {
      failed++;
      console.error(`  Failed for ${item.filename} (${item.key}):`, error);
    }
  });

  console.log(`Backfilled ${done} display version(s), ${failed} failure(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
