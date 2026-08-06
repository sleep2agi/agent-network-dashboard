export class HubDeliveryUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HubDeliveryUnknownError';
  }
}

export class HubDefinitiveError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HubDefinitiveError';
    this.status = status;
  }
}

export async function withAbortTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseMcpResponse(raw: string): Record<string, unknown> {
  const frames = raw.split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean);
  const parsed = frames.length ? JSON.parse(frames.at(-1)!) : JSON.parse(raw);
  const content = parsed?.result?.content?.[0]?.text;
  const result = content ? JSON.parse(content) : parsed;
  if (!result || typeof result !== 'object') throw new Error('invalid hub response');
  return result as Record<string, unknown>;
}

export async function sendWithIdempotentRecovery(options: {
  hubUrl: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const once = async () => withAbortTimeout(timeoutMs, async signal => {
      const res = await fetchImpl(`${options.hubUrl}/mcp`, {
        method: 'POST', headers: options.headers, body: options.body, signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        const message = `hub HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500) throw new HubDefinitiveError(res.status, message);
        throw new Error(message);
      }
      return parseMcpResponse(raw);
  });

  try {
    return await once();
  } catch (firstError: unknown) {
    // A received 4xx is a definitive rejection, not an ambiguous delivery.
    // Retrying it only doubles login/permission latency.
    if (firstError instanceof HubDefinitiveError) throw firstError;
    try {
      return { ...(await once()), recovered: true };
    } catch (error: unknown) {
      throw new HubDeliveryUnknownError(error instanceof Error ? error.message : String(error));
    }
  }
}
