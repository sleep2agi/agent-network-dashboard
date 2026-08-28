import type { Session } from '../components/types';

type SessionLike = Partial<Session> & { agent?: string | null };

export function normalizeSessionIdentity<T extends SessionLike>(session: T): T {
  const agent = session.agent?.toLowerCase() || '';
  const alias = session.alias?.toLowerCase() || '';
  if (!session.runtime && agent.includes('agent-node:grok-build-cli')) {
    return { ...session, runtime: 'grok-build-cli' };
  }
  const isGrok = agent.includes('agent-node:grok') || alias.includes('grok');
  if (!session.runtime && isGrok) {
    return { ...session, runtime: 'grok-build-acp' };
  }
  return session;
}

export function normalizeSessions<T extends SessionLike>(sessions: T[] | undefined): T[] {
  return (sessions || []).map(normalizeSessionIdentity);
}
