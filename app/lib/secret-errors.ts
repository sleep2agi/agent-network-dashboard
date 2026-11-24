// admin 2026-11-24 —— 节点密钥代理的错误出口：只放已知错误码，其它一律 hub_error（不透传上游原文，Dash 欧评审 #463）。

/** Hub 侧已知的节点密钥错误码；其它一律 hub_error（不透传原文）。 */
const KNOWN_SECRET_ERRORS = new Set([
  'secret_admin_required', 'user_token_required', 'node_secrets_upgrade_required', 'invalid_secret_input',
  'secret_store_busy', 'secret_queue_busy', 'node_not_found', 'network_id_required', 'revision_required', 'auth required',
]);
export function knownSecretError(e: unknown): string {
  return typeof e === 'string' && KNOWN_SECRET_ERRORS.has(e) ? e : 'hub_error';
}
