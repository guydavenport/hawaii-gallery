import { loadEnvConfig } from '@next/env';
import { execFileSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const OSXPHOTOS_BIN = path.join(PROJECT_ROOT, '.venv-photos', 'bin', 'osxphotos');
const CONCURRENCY = 3;
const GENERIC_PERSON_REGEX = /\b(person|people|man|woman|men|women|kids?|child|children|boy|girl|group of \w+)\b/i;

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

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  const { readMediaItems, saveMediaItem, generateDescription, buildFallbackDescription } = await import(
    '../app/lib/media'
  );
  const { getObjectBuffer } = await import('../app/lib/s3');
  const { generateThumbnailBuffer } = await import('../app/lib/thumbnail');

  const args = parseArgs();
  const items = await readMediaItems();
  const photos = items.filter((i) => i.type === 'photo');

  // Same classification as scripts/_classify-descriptions.ts: only touch items
  // that are neither the generic fallback nor a personal Photos-app caption.
  const fallback = photos.filter((i) => i.description === buildFallbackDescription(i.title, i.type));
  const withSourceUuid = photos.filter((i) => i.sourceUuid && !fallback.includes(i));
  const noSourceUuid = photos.filter((i) => !i.sourceUuid && !fallback.includes(i));

  const uuids = withSourceUuid.map((i) => i.sourceUuid!);
  let aiCaptionByUuid = new Map<string, string | null>();
  if (uuids.length > 0) {
    const raw = execFileSync(OSXPHOTOS_BIN, ['query', '--json', ...uuids.flatMap((u) => ['--uuid', u])], {
      maxBuffer: 1024 * 1024 * 200,
      encoding: 'utf8',
    });
    const records: { uuid: string; ai_caption: string | null }[] = JSON.parse(raw);
    aiCaptionByUuid = new Map(records.map((r) => [r.uuid, r.ai_caption]));
  }

  const visionOrManual = withSourceUuid.filter((i) => {
    const aiCaption = aiCaptionByUuid.get(i.sourceUuid!);
    return !(aiCaption && capitalize(aiCaption) === i.description);
  });

  let candidates = [...noSourceUuid, ...visionOrManual].filter(
    (item) => item.people && item.people.length > 0 && GENERIC_PERSON_REGEX.test(item.description)
  );
  if (args.limit) candidates = candidates.slice(0, args.limit);

  console.log(`${candidates.length} candidate(s) with recognized people + generic person language.`);

  if (candidates.length === 0) return;

  if (args.dryRun) {
    for (const item of candidates) {
      console.log(`  [dry-run] ${item.filename} | people=${item.people!.join(',')} | "${item.description}"`);
    }
    return;
  }

  let done = 0;
  let failed = 0;

  await runPool(candidates, CONCURRENCY, async (item) => {
    try {
      const buffer = await getObjectBuffer(item.key);
      const thumbBuffer = await generateThumbnailBuffer(buffer);
      const { description: newDescription, source: descriptionSource } = await generateDescription(
        item.title,
        item.type,
        item.location,
        thumbBuffer ?? undefined,
        item.people || []
      );
      if (newDescription === item.description || newDescription === buildFallbackDescription(item.title, item.type)) {
        failed++;
        console.warn(`  No change / vision failed for ${item.filename}`);
        return;
      }
      await saveMediaItem({ ...item, description: newDescription, descriptionSource });
      done++;
      console.log(`  ${item.filename}: "${item.description}" -> "${newDescription}"`);
    } catch (error) {
      failed++;
      console.error(`  Failed for ${item.filename}:`, error);
    }
  });

  console.log(`Updated ${done} description(s), ${failed} failure(s)/unchanged.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
