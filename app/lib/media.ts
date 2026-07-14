import { promises as fs } from 'fs';
import path from 'path';

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
  url: string;
  filename: string;
  owner: string;
}

const DATA_PATH = path.join(process.cwd(), 'data', 'media.json');
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

async function ensureStore() {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fs.access(DATA_PATH);
  } catch {
    await fs.writeFile(DATA_PATH, '[]\n', 'utf8');
  }
}

export async function readMediaItems(): Promise<MediaItem[]> {
  await ensureStore();
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  return JSON.parse(raw) as MediaItem[];
}

export async function writeMediaItems(items: MediaItem[]) {
  await ensureStore();
  await fs.writeFile(DATA_PATH, JSON.stringify(items, null, 2) + '\n', 'utf8');
}

export async function saveMediaItem(item: MediaItem) {
  const items = await readMediaItems();
  items.unshift(item);
  await writeMediaItems(items);
  return item;
}

export async function saveUploadedFile(file: File, itemId: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const targetName = `${itemId}-${safeName}`;
  const targetPath = path.join(UPLOAD_DIR, targetName);
  await fs.writeFile(targetPath, bytes);
  return `/uploads/${targetName}`;
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
