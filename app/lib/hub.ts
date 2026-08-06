import { getV3UserToken } from './dashboard-auth';

function getHubUrl() {
  return process.env.COMMHUB_URL || 'http://127.0.0.1:9200';
}

export const HUB_URL = getHubUrl();

export function hubHeaders(): Record<string, string> {
  return {};
}

/**
 * Fetch from CommHub. Uses the browser session's V3 user token when available.
 * Dashboard is a thin proxy and does not fall back to a service/master token.
 */
export async function hubFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${getHubUrl()}${path}`;

  // Build auth: prefer V3 token cookie unless caller supplied Authorization.
  let authHeader: Record<string, string> = {};

  // Only try V3 token if no Authorization already in init.headers
  const initHeaders = init?.headers as Record<string, string> | undefined;
  if (!initHeaders?.['Authorization']) {
    try {
      const userToken = await getV3UserToken();
      if (userToken) {
        authHeader = { 'Authorization': `Bearer ${userToken}` };
      }
    } catch {
      // cookies() not available in this context, ignore
    }

  }

  return fetch(url, {
    ...init,
    headers: { ...authHeader, ...init?.headers },
    next: { revalidate: 0 },
  } as RequestInit);
}
