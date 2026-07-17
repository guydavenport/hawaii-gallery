import {
  RekognitionClient,
  DetectFacesCommand,
  SearchFacesByImageCommand,
  IndexFacesCommand,
  type BoundingBox,
} from '@aws-sdk/client-rekognition';
import sharp from 'sharp';
import { generateRekognitionBuffer } from '@/app/lib/thumbnail';

export const FACE_COLLECTION_ID = 'hawaii-gallery-family';
const SIMILARITY_THRESHOLD = 90;

export const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Detects faces in an image, returning bounding boxes sorted left-to-right.
 * When `maxFaces` is set, keeps only the largest N faces first (the
 * foreground subjects) before ordering -- filters out small background
 * faces (other diners, passersby) in busy scenes.
 */
export async function detectFaceBoxes(buffer: Buffer, maxFaces?: number): Promise<BoundingBox[]> {
  const response = await rekognitionClient.send(new DetectFacesCommand({ Image: { Bytes: buffer } }));
  let boxes = (response.FaceDetails || []).map((face) => face.BoundingBox).filter((box): box is BoundingBox => !!box);

  if (maxFaces != null && boxes.length > maxFaces) {
    boxes = boxes
      .sort((a, b) => (b.Width ?? 0) * (b.Height ?? 0) - (a.Width ?? 0) * (a.Height ?? 0))
      .slice(0, maxFaces);
  }

  return boxes.sort((a, b) => (a.Left ?? 0) - (b.Left ?? 0));
}

/** Crops a single face (with padding for context) out of a full image using a normalized bounding box. */
export async function cropFace(buffer: Buffer, box: BoundingBox, paddingRatio = 0.4): Promise<Buffer> {
  const { width, height } = await sharp(buffer).rotate().metadata();
  if (!width || !height) throw new Error('Could not read image dimensions');

  const boxWidth = (box.Width ?? 0) * width;
  const boxHeight = (box.Height ?? 0) * height;
  const boxLeft = (box.Left ?? 0) * width;
  const boxTop = (box.Top ?? 0) * height;

  const padX = boxWidth * paddingRatio;
  const padY = boxHeight * paddingRatio;

  const left = Math.max(0, Math.round(boxLeft - padX));
  const top = Math.max(0, Math.round(boxTop - padY));
  const right = Math.min(width, Math.round(boxLeft + boxWidth + padX));
  const bottom = Math.min(height, Math.round(boxTop + boxHeight + padY));

  return sharp(buffer)
    .rotate()
    .extract({ left, top, width: right - left, height: bottom - top })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Indexes a single-face image into the collection under the given person name. */
export async function indexFace(buffer: Buffer, personName: string): Promise<void> {
  await rekognitionClient.send(
    new IndexFacesCommand({
      CollectionId: FACE_COLLECTION_ID,
      Image: { Bytes: buffer },
      ExternalImageId: personName,
      MaxFaces: 1,
      QualityFilter: 'AUTO',
      DetectionAttributes: [],
    })
  );
}

/**
 * Detects every face in a photo and matches each against the collection,
 * returning the unique set of recognized person names (deduplicated,
 * above the similarity threshold). Returns [] for photos with no
 * confidently-matched faces (unrecognized people, or none at all).
 */
export async function matchFacesInImage(buffer: Buffer): Promise<string[]> {
  const boxes = await detectFaceBoxes(buffer);
  if (boxes.length === 0) return [];

  const names = new Set<string>();

  for (const box of boxes) {
    try {
      const faceCrop = await cropFace(buffer, box);
      const response = await rekognitionClient.send(
        new SearchFacesByImageCommand({
          CollectionId: FACE_COLLECTION_ID,
          Image: { Bytes: faceCrop },
          FaceMatchThreshold: SIMILARITY_THRESHOLD,
          MaxFaces: 1,
        })
      );
      const bestMatch = response.FaceMatches?.[0];
      const name = bestMatch?.Face?.ExternalImageId;
      if (name) names.add(name);
    } catch {
      // A single unmatched/low-quality face crop shouldn't fail the whole photo.
      continue;
    }
  }

  return Array.from(names);
}

/**
 * Matches faces in a photo given its original upload buffer. Re-encodes to a
 * size Rekognition can accept (5MB API limit, and it can't read HEIC/HEIF
 * directly) while staying large enough for small/distant faces to detect
 * reliably.
 */
export async function matchFacesInPhoto(originalBuffer: Buffer): Promise<string[]> {
  const searchableBuffer = await generateRekognitionBuffer(originalBuffer);
  if (!searchableBuffer) return [];
  return matchFacesInImage(searchableBuffer);
}
