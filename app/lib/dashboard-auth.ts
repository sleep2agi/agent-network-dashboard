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

// #1636 —— cookie 里的 V3 令牌必须**真的问一次 Hub**，不能只看前缀。
// 以前只校验形状，于是任何 `v3:ntok_随便写` 都被当成已登录：Hub 侧 401 又被
// 各路由的兜底吞成 `200 + 空数组`，用户看到的是“还没有任务”，而不是“会话失效”。
//
// 代价控制：每个令牌 60 秒内只验一次（Map 缓存）。
// 失败策略：**只有 Hub 明确 401 才判无效**；网络错误/超时一律放行（fail-open），
// 否则 Hub 抖动会把所有人踢到登录页——那比“多显示一个空列表”更糟。
const TOKEN_TTL_MS = 60_000;
const tokenValidity = new Map<string, { valid: boolean; until: number }>();

async function isV3TokenLive(token: string): Promise<boolean> {
  const now = Date.now();
  const cached = tokenValidity.get(token);
  if (cached && cached.until > now) return cached.valid;

  const hub = (process.env.COMMHUB_URL || 'http://127.0.0.1:9200').replace(/\/$/, '');
  let valid = true; // fail-open
  try {
    const res = await fetch(`${hub}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401 || res.status === 403) valid = false;
  } catch {
    valid = true;
  }
  tokenValidity.set(token, { valid, until: now + TOKEN_TTL_MS });
  // 防止 Map 无界增长：超过 500 条就清空（令牌数量远小于此）
  if (tokenValidity.size > 500) tokenValidity.clear();
  return valid;
}

export async function verifyDashboardSession() {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value || '';

  // V3 token (atok_/utok_/ntok_) — stored as "v3:xxx"
  if (sessionValue.startsWith('v3:')) {
    const token = sessionValue.slice(3);
    const validPrefix = token.startsWith('atok_') || token.startsWith('utok_') || token.startsWith('ntok_');
    if (!validPrefix || token.length <= 10) return false;
    return isV3TokenLive(token);
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
