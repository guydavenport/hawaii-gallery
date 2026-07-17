import path from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createViewUrl } from '@/app/lib/s3';

export type MediaType = 'photo' | 'video';
export type DescriptionSource = 'vision' | 'manual' | 'fallback';

export interface MediaItem {
  id: string;
  title: string;
  description: string;
  type: MediaType;
  location: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  key: string;
  filename: string;
  owner: string;
  sourceUuid?: string;
  hidden?: boolean;
  thumbnailKey?: string;
  displayKey?: string;
  people?: string[];
  descriptionSource?: DescriptionSource;
}

export interface MediaItemWithUrl extends MediaItem {
  url: string;
  thumbnailUrl: string;
  displayUrl: string;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getTableName() {
  return requireEnv('DYNAMODB_TABLE');
}

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function readMediaItems(): Promise<MediaItem[]> {
  const tableName = getTableName();
  const items: MediaItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastEvaluatedKey })
    );
    items.push(...((response.Items || []) as MediaItem[]));
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveMediaItem(item: MediaItem) {
  const tableName = getTableName();
  await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

export async function saveMediaItems(newItems: MediaItem[]) {
  if (newItems.length === 0) return newItems;
  const tableName = getTableName();

  for (const batch of chunk(newItems, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
        },
      })
    );
  }

  return newItems;
}

export async function deleteMediaItems(ids: string[]) {
  if (ids.length === 0) return;
  const tableName = getTableName();

  for (const batch of chunk(ids, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((id) => ({ DeleteRequest: { Key: { id } } })),
        },
      })
    );
  }
}

export async function updateMediaItem(
  id: string,
  updates: Partial<Pick<MediaItem, 'description' | 'hidden' | 'title' | 'location' | 'owner' | 'descriptionSource'>>
): Promise<MediaItem | null> {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return null;

  const tableName = getTableName();
  const updateExpression = `SET ${entries.map((_, i) => `#f${i} = :v${i}`).join(', ')}`;
  const expressionAttributeNames = Object.fromEntries(entries.map(([key], i) => [`#f${i}`, key]));
  const expressionAttributeValues = Object.fromEntries(entries.map(([, value], i) => [`:v${i}`, value]));

  try {
    const response = await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(id)',
        ReturnValues: 'ALL_NEW',
      })
    );
    return (response.Attributes as MediaItem) || null;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return null;
    }
    throw error;
  }
}

export function visibleToRole(items: MediaItem[], role: 'admin' | 'guest'): MediaItem[] {
  if (role === 'admin') return items;
  return items.filter((item) => !item.hidden);
}

export async function withViewUrls(items: MediaItem[]): Promise<MediaItemWithUrl[]> {
  return Promise.all(
    items.map(async (item) => {
      const url = await createViewUrl(item.key);
      const thumbnailUrl = item.thumbnailKey ? await createViewUrl(item.thumbnailKey) : url;
      const displayUrl = item.displayKey ? await createViewUrl(item.displayKey) : url;
      return { ...item, url, thumbnailUrl, displayUrl };
    })
  );
}

export function inferTypeFromFilename(filename: string): MediaType {
  const videoExtensions = ['.mp4', '.mov', '.m4v', '.webm', '.avi'];
  const ext = path.extname(filename).toLowerCase();
  return videoExtensions.includes(ext) ? 'video' : 'photo';
}

export function buildFallbackDescription(title: string, type: MediaType) {
  const typeLabel = type === 'video' ? 'video clip' : 'photo';
  return `A ${typeLabel} from the Hawaii trip captured as ${title.toLowerCase() || 'a memorable moment'}.`;
}

const VISION_PROMPT_TEMPLATE = (location: string, people: string[]) => {
  const peopleClause =
    people.length > 0
      ? ` The people in this photo have been identified as: ${people.join(', ')}. Use their actual names naturally ` +
        `in the caption instead of generic terms like "a person" or "two people" -- but only if the photo is really ` +
        `about them; don't force names into a caption about scenery, food, or an object.`
      : ` Don't invent names for people; refer to them generically ("a person", "two kids").`;

  return (
    `This photo is from a private family trip to Hawaii${location && location !== 'Hawaii' ? `, taken near ${location}` : ''}. ` +
    `Write exactly one short, warm sentence (under 20 words) describing what is actually visible in the photo -- ` +
    `people, activities, food, scenery, or notable details.${peopleClause} Don't mention that it's Hawaii or add ` +
    `generic filler. Reply with only the sentence, no preamble.`
  );
};

async function generateVisionCaption(imageBuffer: Buffer, location: string, people: string[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: imageBuffer.toString('base64') },
              },
              { type: 'text', text: VISION_PROMPT_TEMPLATE(location, people) },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic vision request failed: ${response.status}`);
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((block) => block.type === 'text')?.text?.trim();
    return text || null;
  } catch (error) {
    console.error('Vision caption generation failed:', error);
    return null;
  }
}

/**
 * Generates a description for a media item. When a JPEG image buffer is
 * supplied for a photo and ANTHROPIC_API_KEY is configured, asks Claude's
 * vision model to caption the actual image content; otherwise (videos, no
 * key, no buffer, or a failed request) falls back to a generic template.
 */
export async function generateDescription(
  title: string,
  type: MediaType,
  location: string,
  imageBuffer?: Buffer,
  people: string[] = []
): Promise<{ description: string; source: DescriptionSource }> {
  if (imageBuffer && type === 'photo') {
    const caption = await generateVisionCaption(imageBuffer, location, people);
    if (caption) return { description: caption, source: 'vision' };
  }
  return { description: buildFallbackDescription(title, type), source: 'fallback' };
}
