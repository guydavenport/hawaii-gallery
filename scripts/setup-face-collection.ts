import { loadEnvConfig } from '@next/env';
import { promises as fsp } from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const REF_DIR =
  '/private/tmp/claude-501/-Users-guydavenport-Projects-daveneti-hawaii-gallery/9a0001fa-b954-4795-9ae8-90f4f251c9ad/scratchpad/face-candidates';

// Each entry: reference image + the people in it, left-to-right, matching
// detectFaceBoxes' left-to-right sort order.
const REFERENCES: { file: string; peopleLeftToRight: string[] }[] = [
  { file: 'IMG_1167.jpeg', peopleLeftToRight: ['Attilio', 'Guy'] },
  { file: 'IMG_1168.jpeg', peopleLeftToRight: ['Gianinna'] },
  { file: 'IMG_2332.jpg', peopleLeftToRight: ['Gianinna', 'Marite'] },
  { file: 'IMG_2299.jpg', peopleLeftToRight: ['Pedro'] },
  { file: 'gmp-trio.jpg', peopleLeftToRight: ['Gianinna', 'Marite', 'Paty'] },
  { file: 'pga-trio.jpg', peopleLeftToRight: ['Pedro', 'Guy', 'Attilio'] },
];

async function main() {
  loadEnvConfig(PROJECT_ROOT);
  const { detectFaceBoxes, cropFace, indexFace } = await import('../app/lib/faces');

  for (const ref of REFERENCES) {
    const filePath = path.join(REF_DIR, ref.file);
    const buffer = await fsp.readFile(filePath);
    const boxes = await detectFaceBoxes(buffer, ref.peopleLeftToRight.length);

    console.log(`${ref.file}: using largest ${boxes.length} face(s) (expected ${ref.peopleLeftToRight.length})`);
    if (boxes.length !== ref.peopleLeftToRight.length) {
      console.warn(`  MISMATCH -- skipping this file, check manually`);
      continue;
    }

    for (let i = 0; i < boxes.length; i++) {
      const name = ref.peopleLeftToRight[i];
      const crop = await cropFace(buffer, boxes[i]);
      await indexFace(crop, name);
      console.log(`  indexed face ${i} -> ${name}`);
    }
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
