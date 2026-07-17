import { loadEnvConfig } from '@next/env';

const PROJECT_ROOT = process.cwd();

// Each group: keep[] stays, remove[] gets deleted (DynamoDB record + all
// its S3 objects: original, thumbnail, display). Matched by filename+owner
// since that pair is unique here (verified against the actual item list).
const GROUPS: { label: string; keep: [string, string][]; remove: [string, string][] }[] = [
  {
    label: 'Bar/restaurant photo (Pedro, Guy, Attilio)',
    keep: [
      ['IMG_1258.jpg', 'Gianinna'],
      ['IMG_1259.jpg', 'Gianinna'],
      ['IMG_1260.jpg', 'Gianinna'],
    ],
    remove: [['daccea58-bf67-4eff-bb6c-e626dc312e54.JPG', 'Paty']],
  },
  {
    label: 'Street/group photo series (Mauloa Place area)',
    keep: [
      ['IMG_1275.jpg', 'Gianinna'],
      ['IMG_1276.jpg', 'Gianinna'],
      ['IMG_1277.jpg', 'Gianinna'],
      ['IMG_1278.jpg', 'Gianinna'],
      ['IMG_1279.jpg', 'Gianinna'],
    ],
    remove: [
      ['cd90ebdd-2853-4333-acac-e0620936f7cf.JPG', 'Paty'],
      ['526335b9-2a58-4786-a997-08c9488d0406.JPG', 'Paty'],
      ['417b5d5a-03bf-4014-a5e0-50b85bb50dbc.JPG', 'Paty'],
      ['628b3afb-45e5-4d1d-9e55-906faba2b085.JPG', 'Paty'],
      ['4b857a8a-8982-4f0c-a621-3ecd87d6b2fa.JPG', 'Paty'],
    ],
  },
  {
    label: 'Single photo A (Mauloa Place area)',
    keep: [['IMG_1265.jpg', 'Gianinna']],
    remove: [['57d7b70c-60f0-4cc2-ac2b-a38934d4324a.JPG', 'Paty']],
  },
  {
    label: 'Single photo B (Mauloa Place area)',
    keep: [['IMG_1270.jpg', 'Gianinna']],
    remove: [['0430f257-b20b-4483-af87-72bfc8208641.JPG', 'Paty']],
  },
  {
    label: 'Beach couple photo (Pedro & Marite)',
    keep: [['34d213a5-e735-4fab-9424-d326dd17f4d2.jpg', 'Paty']],
    remove: [['WhatsApp Image 2026-07-13 at 12.40.29.jpeg', 'Marite']],
  },
  {
    label: 'Rock formation photo',
    keep: [['IMG_2329.HEIC', 'Paty']],
    remove: [
      ['WhatsApp Image 2026-07-13 at 12.43.04.jpeg', 'Paty'],
      ['WhatsApp Image 2026-07-15 at 09.23.00.jpeg', 'Paty'],
    ],
  },
  {
    label: 'Another photo (HEIC + WhatsApp resend)',
    keep: [['IMG_2346.HEIC', 'Paty']],
    remove: [['WhatsApp Image 2026-07-15 at 09.22.31.jpeg', 'Paty']],
  },
];

interface CliArgs {
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  return { dryRun: process.argv.slice(2).includes('--dry-run') };
}

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { readMediaItems, deleteMediaItems } = await import('../app/lib/media');
  const { s3Client, getBucket } = await import('../app/lib/s3');
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

  const args = parseArgs();
  const items = await readMediaItems();

  function findItem(filename: string, owner: string) {
    return items.find((i) => i.filename === filename && i.owner === owner);
  }

  const toRemove: (typeof items)[number][] = [];
  let missing = 0;

  for (const group of GROUPS) {
    console.log(`\n=== ${group.label} ===`);
    for (const [filename, owner] of group.keep) {
      const item = findItem(filename, owner);
      console.log(`  KEEP:   ${filename} (${owner})${item ? '' : '  [NOT FOUND]'}`);
      if (!item) missing++;
    }
    for (const [filename, owner] of group.remove) {
      const item = findItem(filename, owner);
      console.log(`  REMOVE: ${filename} (${owner})${item ? '' : '  [NOT FOUND]'}`);
      if (!item) {
        missing++;
        continue;
      }
      toRemove.push(item);
    }
  }

  console.log(`\n${toRemove.length} item(s) to remove, ${missing} not found (should be 0).`);

  if (args.dryRun) {
    console.log('[dry-run] no changes made.');
    return;
  }

  if (missing > 0) {
    console.error('Aborting: some items in the keep/remove lists were not found. Check filenames/owners.');
    process.exit(1);
  }

  const ids = toRemove.map((i) => i.id);
  await deleteMediaItems(ids);
  console.log(`Deleted ${ids.length} DynamoDB record(s).`);

  for (const item of toRemove) {
    const keysToDelete = [item.key, item.thumbnailKey, item.displayKey].filter(Boolean) as string[];
    for (const key of keysToDelete) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
    }
    console.log(`  Deleted S3 object(s) for ${item.filename}: ${keysToDelete.join(', ')}`);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
