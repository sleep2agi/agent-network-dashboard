import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = '/tmp/agent-network-dashboard-uploads';
const MAX_BYTES = 12 * 1024 * 1024;

function safeName(name: string) {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${Date.now()}-${randomUUID()}${ext || '.bin'}`;
}

function isImage(type: string, filename: string) {
  return type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(filename);
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'missing file' }, { status: 400 });
    }
    if (!isImage(file.type, file.name)) {
      return Response.json({ error: 'only image uploads are supported' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'image is too large', max_bytes: MAX_BYTES }, { status: 413 });
    }

    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = safeName(file.name);
    const fullPath = path.join(UPLOAD_DIR, filename);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, bytes);

    return Response.json({
      ok: true,
      filename,
      path: fullPath,
      url: `/api/hub/upload?file=${encodeURIComponent(filename)}`,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    });
  } catch (e: unknown) {
    return Response.json({ error: 'upload failed', detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const filename = url.searchParams.get('file') || '';
  if (!/^[0-9]+-[a-f0-9-]+\.[a-z0-9]+$/i.test(filename)) {
    return Response.json({ error: 'invalid file' }, { status: 400 });
  }

  try {
    const fullPath = path.join(UPLOAD_DIR, filename);
    const data = await readFile(fullPath);
    const ext = path.extname(filename).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png' :
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      ext === '.gif' ? 'image/gif' :
      ext === '.webp' ? 'image/webp' :
      'application/octet-stream';
    return new Response(data, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}
