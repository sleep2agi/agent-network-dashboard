import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireDashboardAuth } from '@/app/lib/dashboard-auth';

interface RawAnetConfig {
  hub?: unknown;
  token?: unknown;
}

const CONFIG_PATH = join(homedir(), '.anet', 'config.json');

function previewToken(token: string) {
  if (token.length <= 8) return 'configured';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const envHub = process.env.COMMHUB_URL?.trim() || null;
  const envToken = process.env.COMMHUB_AUTH_TOKEN?.trim() || '';

  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    const raw = JSON.parse(text) as RawAnetConfig;
    const fileHub = typeof raw.hub === 'string' ? raw.hub : null;
    const fileToken = typeof raw.token === 'string' ? raw.token : '';
    const effectiveHub = envHub || fileHub;
    const effectiveToken = envToken || fileToken;
    const overriddenByEnv = Boolean(envHub || envToken);

    return Response.json({
      path: CONFIG_PATH,
      exists: true,
      source: overriddenByEnv ? 'runtime-env' : 'file',
      hub: effectiveHub,
      tokenConfigured: effectiveToken.length > 0,
      tokenPreview: effectiveToken ? previewToken(effectiveToken) : null,
      error: overriddenByEnv ? 'local config loaded; runtime environment overrides are active' : undefined,
    });
  } catch (e: unknown) {
    const isMissing =
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      e.code === 'ENOENT';

    return Response.json({
      path: CONFIG_PATH,
      exists: false,
      source: envHub || envToken ? 'runtime-env' : 'missing',
      hub: envHub,
      tokenConfigured: envToken.length > 0,
      tokenPreview: envToken ? previewToken(envToken) : null,
      error: isMissing ? 'config not found' : e instanceof Error ? e.message : String(e),
    });
  }
}
