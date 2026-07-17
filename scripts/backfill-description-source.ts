import { loadEnvConfig } from '@next/env';
import { execFileSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const OSXPHOTOS_BIN = path.join(PROJECT_ROOT, '.venv-photos', 'bin', 'osxphotos');

interface CliArgs {
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  return { dryRun: process.argv.slice(2).includes('--dry-run') };
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { readMediaItems, saveMediaItem, buildFallbackDescription } = await import('../app/lib/media');

  const args = parseArgs();
  const items = await readMediaItems();

  const withSourceUuid = items.filter((i) => i.sourceUuid);
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

  const counts = { fallback: 0, vision: 0, manual: 0 };
  const updates: { id: string; descriptionSource: 'fallback' | 'vision' | 'manual' }[] = [];

  for (const item of items) {
    let source: 'fallback' | 'vision' | 'manual';

    if (item.description === buildFallbackDescription(item.title, item.type)) {
      source = 'fallback';
    } else {
      const aiCaption = item.sourceUuid ? aiCaptionByUuid.get(item.sourceUuid) : null;
      if (aiCaption && capitalize(aiCaption) === item.description) {
        // Apple's on-device auto-caption is AI-generated, not human-typed.
        source = 'vision';
      } else if (item.type === 'video') {
        // Vision captioning only ever runs for photos, so a non-fallback,
        // non-Apple-caption video description can only be manual.
        source = 'manual';
      } else {
        // Best-effort: no stored audit trail distinguishes "vision, never
        // touched since" from "vision, then hand-edited afterward."
        source = 'vision';
      }
    }

    counts[source]++;
    if (item.descriptionSource !== source) {
      updates.push({ id: item.id, descriptionSource: source });
    }
  }

  console.log(`Classification: ${JSON.stringify(counts)}`);
  console.log(`${updates.length} item(s) need a descriptionSource update.`);
  const manualItems = items.filter((i) => updates.some((u) => u.id === i.id && u.descriptionSource === 'manual'));
  for (const i of manualItems) {
    console.log(`  [manual] ${i.filename} | "${i.description}"`);
  }

  if (args.dryRun || updates.length === 0) return;

  const byId = new Map(items.map((i) => [i.id, i]));
  for (const { id, descriptionSource } of updates) {
    const item = byId.get(id)!;
    await saveMediaItem({ ...item, descriptionSource });
  }

  console.log(`Updated ${updates.length} item(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
