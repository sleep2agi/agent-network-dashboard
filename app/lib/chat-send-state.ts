export interface ChatSendResult {
  accepted: boolean;
  messageId?: string;
  status?: string;
}

export function newDashboardRequestId(cryptoImpl: Crypto = globalThis.crypto): string {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return `dreq_${cryptoImpl.randomUUID().replace(/-/g, '')}`;
  }
  // randomUUID is secure-context-only in some browsers/webviews, while
  // getRandomValues remains available on LAN HTTP deployments.
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  return `dreq_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeChatSendResult(data: unknown): ChatSendResult {
  if (!data || typeof data !== 'object') return { accepted: false };
  const value = data as Record<string, unknown>;
  const messageId = typeof value.message_id === 'string' && value.message_id ? value.message_id : undefined;
  if (!messageId || (value.ok !== true && value.queued !== true)) return { accepted: false };
  return {
    accepted: true,
    messageId,
    status: value.queued === true
      ? 'queued'
      : (typeof value.task_status === 'string' && value.task_status ? value.task_status : 'delivered'),
  };
}

export function requestIdFromTaskMeta(metaJson: unknown): string | null {
  if (typeof metaJson !== 'string' || !metaJson) return null;
  try {
    const parsed = JSON.parse(metaJson);
    const value = parsed?.client_request_id;
    return typeof value === 'string' && /^dreq_[A-Za-z0-9_-]{16,96}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
