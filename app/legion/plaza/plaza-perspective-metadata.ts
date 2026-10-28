import type { Session } from '../../components/types';

export interface PlazaNodeMetadata {
  node_id: string; alias?: string; network_id?: string; model?: string; runtime?: string;
  hostname?: string; server?: string; project_dir?: string; lifecycle_state?: string;
  lifecycle_controllable?: boolean; lifecycle_daemon_node_id?: string; display_name?: string;
}
export interface PlazaAgentSnapshot { status?: string; model?: string | null; runtime?: string | null }

/** Never borrow another node's session through an alias match (including old duplicates). */
export function plazaAgentSnapshots(nodes: PlazaNodeMetadata[], sessions: Session[], networkId: string) {
  const result = new Map<string, PlazaAgentSnapshot>();
  for (const session of sessions) {
    if (!session.node_id || (session.network_id && session.network_id !== networkId)) continue;
    result.set(session.node_id, { status: session.status, model: session.model, runtime: session.runtime ?? session.agent });
  }
  for (const node of nodes) {
    if (node.network_id && node.network_id !== networkId) continue;
    const previous = result.get(node.node_id);
    result.set(node.node_id, { ...previous, model: node.model ?? previous?.model, runtime: node.runtime ?? previous?.runtime });
  }
  return result;
}
