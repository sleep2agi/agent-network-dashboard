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
  // #111: working directory — nodes sharing a project_dir are one group
  // (a more precise "same project" signal than the alias prefix).
  project_dir?: string | null;
  // #96: model vendor + execution runtime. Added to /api/status sessions in
  // commhub-server 0.8.1-preview.0; null on older nodes / older hubs.
  model?: string | null;
  runtime?: string | null;
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
