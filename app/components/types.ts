export interface Session {
  alias: string;
  status: string;
  agent: string;
  server: string;
  task: string;
  progress: number;
  updated_at: string;
  node_id?: string;
  session_id?: string;
  channels?: string[] | string | null;
  last_seen_at?: string;
  config_path?: string;
  network_id?: string;
}

export interface Health {
  ok: boolean;
  version: string;
  sessions: number;
  sse_connections: number;
  sse_sessions: Record<string, number>;
  uptime: number;
  auth?: string;
}

export interface InboxMessage {
  id: string;
  content: string;
  from_session: string;
  created_at: string;
}

export interface AnetConfig {
  path: string;
  exists: boolean;
  source: 'file' | 'runtime-env' | 'missing';
  hub: string | null;
  tokenConfigured: boolean;
  tokenPreview: string | null;
  error?: string;
}
