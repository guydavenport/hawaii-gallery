import { execFileSync } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import { loadEnvConfig } from '@next/env';

const PROJECT_ROOT = process.cwd();
const OSXPHOTOS_BIN = path.join(PROJECT_ROOT, '.venv-photos', 'bin', 'osxphotos');
const STAGING_DIR = path.join(PROJECT_ROOT, '.video-repair-staging');

// Discovered via headObject: these items have a real S3 object but its
// content is a tiny Photos "adjustmentdata" plist instead of the actual
// video -- a batch-export collision in the original bulk import, not
// reproducible when re-exporting the same uuid in isolation.
const CORRUPT_UUIDS = [
  'AC2E5BE9-748A-4E41-937E-A030F7367110', // IMG_1402.mov
  '26CD7FC4-A761-42AB-A7A4-6CD4C9062B11', // IMG_1403.mov
  'E388E973-E207-44F8-A6EA-C16EE5061250', // IMG_1404.mov
  '6AF85664-0092-4EB1-BD4C-DBFBDF16F42F', // IMG_1405.mov
  'BA041EB5-D277-4364-B115-14445BD77C66', // IMG_1406.mov
  'A63DF63B-1E0B-47D7-BF1F-58CD1848D06E', // IMG_1407.mov
  'D570AF06-C2B6-4AD0-9753-806D1F02AB91', // IMG_1408.mov
  'B7084B00-7E46-4BD9-B9CE-17A5917E2362', // IMG_1751.mov
  'CA88045A-AC29-40C0-908F-FE1E4F52E203', // IMG_1752.mov
];

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { s3Client, getBucket, headObject } = await import('../app/lib/s3');
  const { readMediaItems, saveMediaItem } = await import('../app/lib/media');
  const { createAndUploadThumbnail } = await import('../app/lib/thumbnail');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');

  const items = await readMediaItems();
  await fsp.mkdir(STAGING_DIR, { recursive: true });

  for (const uuid of CORRUPT_UUIDS) {
    const item = items.find((i) => i.sourceUuid === uuid);
    if (!item) {
      console.warn(`  No item found for uuid ${uuid}, skipping`);
      continue;
    }

    console.log(`Repairing ${item.filename} (${uuid})...`);
    execFileSync(
      OSXPHOTOS_BIN,
      ['export', STAGING_DIR, '--uuid', uuid, '--filename', '{uuid}', '--download-missing', '--update'],
      { stdio: 'inherit' }
    );

    const stagedFiles = await fsp.readdir(STAGING_DIR);
    const match = stagedFiles.find((f) => f.toUpperCase().startsWith(uuid) && f.toLowerCase().endsWith('.mov'));
    if (!match) {
      console.warn(`  Export did not produce a .mov file for ${uuid}, skipping`);
      continue;
    }

    const buffer = await fsp.readFile(path.join(STAGING_DIR, match));
    console.log(`  Exported ${buffer.length} bytes (was corrupt at a few hundred bytes)`);

    if (buffer.length < 100000) {
      console.warn(`  Still suspiciously small, skipping to avoid re-corrupting`);
      continue;
    }

    await s3Client.send(
      new PutObjectCommand({ Bucket: getBucket(), Key: item.key, Body: buffer, ContentType: 'video/quicktime' })
    );
    console.log(`  Uploaded correct content to s3://${getBucket()}/${item.key}`);

    const verifyHead = await headObject(item.key);
    console.log(`  Verified S3 object size: ${verifyHead.size}`);

    const thumbnailKey = await createAndUploadThumbnail(item.key, buffer, 'video');
    if (thumbnailKey) {
      await saveMediaItem({ ...item, thumbnailKey });
      console.log(`  Regenerated thumbnail: ${thumbnailKey}`);
    } else {
      console.warn(`  Thumbnail generation still failed for the repaired video`);
    }
  }

  await fsp.rm(STAGING_DIR, { recursive: true, force: true });
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
