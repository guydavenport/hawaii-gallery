import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const UPLOAD_PREFIX = 'uploads/';
const GET_URL_EXPIRY_SECONDS = 3600;
const PUT_URL_EXPIRY_SECONDS = 300;

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getBucket() {
  return requireEnv('S3_BUCKET');
}

export const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

export function buildUploadKey(itemId: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${UPLOAD_PREFIX}${itemId}-${safeName}`;
}

export async function createUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client, command, { expiresIn: PUT_URL_EXPIRY_SECONDS });
}

export async function createViewUrl(key: string) {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: GET_URL_EXPIRY_SECONDS });
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3Client.send(new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export interface S3ObjectSummary {
  key: string;
  size: number;
  lastModified?: string;
  contentType?: string;
}

export async function listUploadedObjects(): Promise<S3ObjectSummary[]> {
  const results: S3ObjectSummary[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: getBucket(),
        Prefix: UPLOAD_PREFIX,
        ContinuationToken: continuationToken,
      })
    );

    for (const object of response.Contents || []) {
      if (!object.Key || object.Key === UPLOAD_PREFIX) continue;
      results.push({
        key: object.Key,
        size: object.Size || 0,
        lastModified: object.LastModified?.toISOString(),
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return results;
}

export async function headObject(key: string) {
  const response = await s3Client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
  return {
    contentType: response.ContentType,
    size: response.ContentLength || 0,
  };
}
