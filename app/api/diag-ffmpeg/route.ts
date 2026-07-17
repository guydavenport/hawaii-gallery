import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/app/lib/auth';
import { ensureConfigLoaded } from '@/app/lib/runtime-config';
import ffmpegPath from 'ffmpeg-static';
import { existsSync, statSync } from 'fs';
import { execFileSync } from 'child_process';

export async function GET(request: NextRequest) {
  await ensureConfigLoaded();
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result: Record<string, unknown> = { ffmpegPath };

  if (ffmpegPath) {
    result.exists = existsSync(ffmpegPath);
    if (result.exists) {
      const stat = statSync(ffmpegPath);
      result.mode = stat.mode.toString(8);
      result.size = stat.size;
      try {
        const version = execFileSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 5000 });
        result.versionOutput = version.split('\n')[0];
      } catch (error) {
        result.execError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return NextResponse.json(result);
}
