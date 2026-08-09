export interface HubUploadLimits {
  max_upload_bytes: number;
  max_request_content_length: number;
}

export interface ResolvedHubUploadLimits extends HubUploadLimits {
  source: 'hub-health' | 'compat-fallback';
}

export const COMPAT_UPLOAD_LIMITS: HubUploadLimits = {
  max_upload_bytes: 12 * 1024 * 1024,
  max_request_content_length: 13 * 1024 * 1024,
};

interface LimitCache {
  value?: ResolvedHubUploadLimits;
  loading?: Promise<ResolvedHubUploadLimits>;
  fallbackLogged: boolean;
}

const CACHE_KEY = '__anetDashboardHubUploadLimitsV1';

function cache(): LimitCache {
  const root = globalThis as typeof globalThis & { [CACHE_KEY]?: LimitCache };
  return (root[CACHE_KEY] ??= { fallbackLogged: false });
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseHubUploadLimits(health: unknown): HubUploadLimits | null {
  if (!health || typeof health !== 'object') return null;
  const limits = (health as { limits?: unknown }).limits;
  if (!limits || typeof limits !== 'object') return null;
  const maxUpload = (limits as Record<string, unknown>).max_upload_bytes;
  const maxRequest = (limits as Record<string, unknown>).max_request_content_length;
  if (!positiveSafeInteger(maxUpload) || !positiveSafeInteger(maxRequest)) return null;
  if (maxRequest < maxUpload) return null;
  return { max_upload_bytes: maxUpload, max_request_content_length: maxRequest };
}

/**
 * Warm the process-wide cache from the Dashboard's normal boot-time health
 * request. This avoids a second Hub call in the common path. A later valid
 * health response may replace a compatibility fallback established earlier.
 */
export function recordHubUploadLimits(health: unknown): boolean {
  const parsed = parseHubUploadLimits(health);
  if (!parsed) return false;
  cache().value = { ...parsed, source: 'hub-health' };
  return true;
}

async function fetchPublicHealth(): Promise<unknown> {
  const hubUrl = (process.env.COMMHUB_URL || 'http://127.0.0.1:9200').replace(/\/+$/, '');
  const res = await fetch(`${hubUrl}/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Hub health returned HTTP ${res.status}`);
  return res.json();
}

/** Resolve once per Dashboard process. Never trusts browser-supplied limits. */
export async function resolveHubUploadLimits(options: {
  fetchHealth?: () => Promise<unknown>;
  logger?: Pick<Console, 'error'>;
} = {}): Promise<ResolvedHubUploadLimits> {
  const state = cache();
  if (state.value) return state.value;
  if (state.loading) return state.loading;
  const fetchHealth = options.fetchHealth ?? fetchPublicHealth;
  const logger = options.logger ?? console;
  const loading = (async () => {
    try {
      const parsed = parseHubUploadLimits(await fetchHealth());
      if (!parsed) throw new Error('Hub health omitted valid upload limits');
      return (state.value = { ...parsed, source: 'hub-health' });
    } catch (error) {
      // The normal boot health proxy may have populated an authoritative
      // value while this lazy request was in flight. Never overwrite that
      // newer fact with a compatibility fallback.
      if (state.value?.source === 'hub-health') return state.value;
      if (!state.fallbackLogged) {
        state.fallbackLogged = true;
        logger.error(
          `[upload-proxy] using compatibility upload limits because Hub /health limits are unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return (state.value = { ...COMPAT_UPLOAD_LIMITS, source: 'compat-fallback' });
    } finally {
      state.loading = undefined;
    }
  })();
  state.loading = loading;
  return loading;
}

export function resetHubUploadLimitsForTest(): void {
  const root = globalThis as typeof globalThis & { [CACHE_KEY]?: LimitCache };
  delete root[CACHE_KEY];
}
