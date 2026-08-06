import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cookies } from 'next/headers';

export const DASHBOARD_SESSION_COOKIE = 'anet_dashboard_session';

interface RawAnetConfig {
  token?: unknown;
}

const CONFIG_PATH = join(homedir(), '.anet', 'config.json');

function hashSecret(secret: string) {
  return createHash('sha256').update(`anet-dashboard:${secret}`).digest('hex');
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

async function readAnetToken() {
  const text = await readFile(CONFIG_PATH, 'utf8');
  const raw = JSON.parse(text) as RawAnetConfig;
  return typeof raw.token === 'string' ? raw.token : '';
}

export async function getDashboardPassword() {
  const explicit = process.env.DASHBOARD_PASSWORD || process.env.ANET_DASHBOARD_PASSWORD;
  if (explicit) return explicit;
  // Fallback to CommHub token (P0 security: should set DASHBOARD_PASSWORD separately)
  const token = await readAnetToken();
  if (token && !process.env._DASHBOARD_TOKEN_WARN_SHOWN) {
    console.warn('[dashboard] WARNING: using CommHub token as login password. Set DASHBOARD_PASSWORD for security.');
    process.env._DASHBOARD_TOKEN_WARN_SHOWN = '1';
  }
  return token;
}

export async function createDashboardSessionValue(password: string) {
  return hashSecret(password);
}

export async function verifyDashboardPassword(password: string) {
  const expectedPassword = await getDashboardPassword();
  return expectedPassword.length > 0 && safeEqual(hashSecret(password), hashSecret(expectedPassword));
}

export async function verifyDashboardSession() {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value || '';

  // V3 token (atok_/utok_/ntok_) — stored as "v3:xxx"
  if (sessionValue.startsWith('v3:')) {
    const token = sessionValue.slice(3);
    const validPrefix = token.startsWith('atok_') || token.startsWith('utok_') || token.startsWith('ntok_');
    return validPrefix && token.length > 10;
  }

  // Legacy: password hash
  const password = await getDashboardPassword();
  return password.length > 0 && safeEqual(sessionValue, await createDashboardSessionValue(password));
}

/** Extract V3 user token from session cookie, if present */
export async function getV3UserToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value || '';
  if (sessionValue.startsWith('v3:')) return sessionValue.slice(3);
  return null;
}

export async function requireDashboardAuth() {
  if (await verifyDashboardSession()) return null;
  return Response.json({ error: 'login required' }, { status: 401 });
}
