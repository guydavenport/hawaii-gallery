import { loadEnvConfig } from '@next/env';

const PROJECT_ROOT = process.cwd();
const CONCURRENCY = 4;

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
  const { getObjectBuffer } = await import('../app/lib/s3');
  const { matchFacesInPhoto } = await import('../app/lib/faces');
  const { readMediaItems, saveMediaItem } = await import('../app/lib/media');

  const args = parseArgs();
  const items = await readMediaItems();
  let missing = items.filter((item) => item.type === 'photo' && item.people === undefined);
  if (args.limit) missing = missing.slice(0, args.limit);

  console.log(`${items.length} total item(s), ${missing.length} photo(s) not yet face-matched.`);

  if (missing.length === 0) return;

  if (args.dryRun) {
    for (const item of missing) {
      console.log(`  [dry-run] ${item.filename}`);
    }
    return;
  }

  let done = 0;
  let failed = 0;
  let withMatches = 0;

  await runPool(missing, CONCURRENCY, async (item) => {
    try {
      const buffer = await getObjectBuffer(item.key);
      const people = await matchFacesInPhoto(buffer);
      await saveMediaItem({ ...item, people });
      done++;
      if (people.length > 0) {
        withMatches++;
        console.log(`  ${item.filename}: ${people.join(', ')}`);
      }
      if (done % 25 === 0) console.log(`  ${done}/${missing.length} done...`);
    } catch (error) {
      failed++;
      console.error(`  Failed for ${item.filename}:`, error);
    }
  });

  console.log(`Processed ${done} item(s), ${withMatches} with at least one recognized person, ${failed} failure(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
