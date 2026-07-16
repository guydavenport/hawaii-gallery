import { loadEnvConfig } from '@next/env';

const PROJECT_ROOT = process.cwd();

interface CliArgs {
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return { dryRun: args.includes('--dry-run') };
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { readMediaItems, saveMediaItem, generateDescription, buildFallbackDescription } = await import(
    '../app/lib/media'
  );
  const { reverseGeocode } = await import('../app/lib/geocode');

  const args = parseArgs();
  const items = await readMediaItems();
  const missing = items.filter(
    (item) =>
      item.title === 'Hawaii' &&
      item.latitude != null &&
      item.longitude != null &&
      item.description === buildFallbackDescription(item.title, item.type)
  );

  console.log(`${items.length} total item(s), ${missing.length} with GPS but generic "Hawaii" title.`);

  if (missing.length === 0) return;

  if (args.dryRun) {
    for (const item of missing) {
      console.log(`  [dry-run] ${item.filename} (${item.latitude}, ${item.longitude})`);
    }
    return;
  }

  let updated = 0;
  let unresolved = 0;

  // Sequential: Nominatim's usage policy caps anonymous use at ~1 request/second.
  for (const item of missing) {
    const location = await reverseGeocode(item.latitude!, item.longitude!);
    if (!location) {
      unresolved++;
      console.warn(`  Could not resolve location for ${item.filename} (${item.latitude}, ${item.longitude})`);
      continue;
    }
    const description = await generateDescription(location, item.type, location);
    await saveMediaItem({ ...item, title: location, location, description });
    updated++;
    if (updated % 10 === 0) console.log(`  ${updated}/${missing.length} done...`);
  }

  console.log(`Updated ${updated} item(s), ${unresolved} unresolved.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
