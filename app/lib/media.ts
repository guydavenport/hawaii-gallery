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
}

export interface MediaItemWithUrl extends MediaItem {
  url: string;
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
  updates: Partial<Pick<MediaItem, 'description' | 'hidden' | 'title' | 'location'>>
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
    items.map(async (item) => ({
      ...item,
      url: await createViewUrl(item.key),
    }))
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

export async function generateDescription(title: string, type: MediaType, location: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackDescription(title, type);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You write concise, warm travel-photo descriptions for a private family trip gallery.',
          },
          {
            role: 'user',
            content: `Create a short poetic description for a ${type} from Hawaii titled "${title}" taken near ${location || 'a beautiful spot'}.`,
          },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error('OpenAI request failed');
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || buildFallbackDescription(title, type);
  } catch {
    return buildFallbackDescription(title, type);
  }
}
