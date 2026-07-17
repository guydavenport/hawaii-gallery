import { loadEnvConfig } from '@next/env';

const PROJECT_ROOT = process.cwd();
const CONCURRENCY = 3;

interface CliArgs {
  dryRun: boolean;
  limit?: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { dryRun: args.includes('--dry-run') };
  const limitIndex = args.indexOf('--limit');
  if (limitIndex !== -1) result.limit = Number(args[limitIndex + 1]);
  return result;
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

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set in .env.local -- nothing to do.');
    process.exit(1);
  }

  const { getObjectBuffer } = await import('../app/lib/s3');
  const { generateThumbnailBuffer } = await import('../app/lib/thumbnail');
  const { readMediaItems, saveMediaItem, generateDescription, buildFallbackDescription } = await import(
    '../app/lib/media'
  );

  const args = parseArgs();
  const items = await readMediaItems();
  let generic = items.filter(
    (item) => item.type === 'photo' && item.description === buildFallbackDescription(item.title, item.type)
  );
  if (args.limit) generic = generic.slice(0, args.limit);

  console.log(`${items.length} total item(s), ${generic.length} photo(s) with a generic description to caption.`);

  if (generic.length === 0) return;

  if (args.dryRun) {
    for (const item of generic) {
      console.log(`  [dry-run] ${item.filename} | title="${item.title}"`);
    }
    return;
  }

  let done = 0;
  let failed = 0;

  await runPool(generic, CONCURRENCY, async (item) => {
    try {
      const buffer = await getObjectBuffer(item.key);
      const thumbBuffer = await generateThumbnailBuffer(buffer);
      if (!thumbBuffer) {
        failed++;
        console.warn(`  Could not decode image for ${item.filename}`);
        return;
      }
      const { description, source: descriptionSource } = await generateDescription(
        item.title,
        item.type,
        item.location,
        thumbBuffer,
        item.people
      );
      if (description === buildFallbackDescription(item.title, item.type)) {
        failed++;
        console.warn(`  Vision caption failed for ${item.filename}, left unchanged`);
        return;
      }
      await saveMediaItem({ ...item, description, descriptionSource });
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${generic.length} done...`);
    } catch (error) {
      failed++;
      console.error(`  Failed for ${item.filename}:`, error);
    }
  });

  console.log(`Captioned ${done} item(s), ${failed} failure(s)/unchanged.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
