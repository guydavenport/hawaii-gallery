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
  const { getObjectBuffer, putObject } = await import('../app/lib/s3');
  const { embedCopyright } = await import('../app/lib/copyright');
  const { readMediaItems } = await import('../app/lib/media');

  const args = parseArgs();
  const items = await readMediaItems();
  const photos = items.filter((i) => i.type === 'photo');

  console.log(`${photos.length} photo(s) to check (only JPEG sources will actually change).`);

  if (args.dryRun) {
    console.log('[dry-run] would attempt embedCopyright on all photo items; piexifjs silently no-ops for non-JPEG.');
    return;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  await runPool(photos, CONCURRENCY, async (item) => {
    try {
      const buffer = await getObjectBuffer(item.key);
      const copyrighted = embedCopyright(buffer, item.owner);
      if (copyrighted === buffer) {
        skipped++;
        return;
      }
      await putObject(item.key, copyrighted, 'image/jpeg');
      updated++;
      if (updated % 50 === 0) console.log(`  ${updated} updated so far...`);
    } catch (error) {
      failed++;
      console.error(`  Failed for ${item.filename}:`, error);
    }
  });

  console.log(`Embedded copyright in ${updated} file(s), skipped ${skipped} non-JPEG, ${failed} failure(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
