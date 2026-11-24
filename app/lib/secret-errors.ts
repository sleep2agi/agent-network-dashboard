// admin 2026-11-24 —— 节点密钥代理的错误出口：只放已知错误码，其它一律 hub_error（不透传上游原文，Dash 欧评审 #463）。

/** Hub 侧已知的节点密钥错误码；其它一律 hub_error（不透传原文）。 */
const KNOWN_SECRET_ERRORS = new Set([
  'secret_admin_required', 'user_token_required', 'node_secrets_upgrade_required', 'invalid_secret_input',
  'secret_store_busy', 'secret_queue_busy', 'node_not_found', 'network_id_required', 'revision_required', 'auth required',
]);
export function knownSecretError(e: unknown): string {
  return typeof e === 'string' && KNOWN_SECRET_ERRORS.has(e) ? e : 'hub_error';
}

/** 给人看的话：错误码 → 原因 + 下一步（节点密钥对话框与聊天卡共用口径）。 */
export function secretErrorText(code: string | undefined): [zh: string, en: string] {
  switch (code) {
    case 'secret_admin_required': return ['只有节点主人或网络管理员能管理密钥，请让管理员来操作。', 'Only the node owner or a network admin can manage secrets.'];
    case 'node_secrets_upgrade_required': return ['这台机器上的 ANet 版本太旧，升级后再试。', 'This machine runs an old ANet version; upgrade and try again.'];
    case 'invalid_secret_input': return ['密钥名或内容不合法（内容不能为空，最长 8KB）。', 'Invalid key or value (non-empty, up to 8KB).'];
    case 'secret_store_busy': case 'secret_queue_busy': return ['机器正忙，稍等几秒再试。', 'The machine is busy; try again in a few seconds.'];
    case 'node_not_found': return ['找不到这个节点，可能已被删除。', 'Node not found; it may have been deleted.'];
    case 'user_token_required': case 'auth required': case 'no_session': return ['登录已过期，请重新登录。', 'Your session expired; please sign in again.'];
    default: return ['机器暂时没有回应，确认它在线后再试。', 'The machine did not respond; make sure it is online and try again.'];
  }
}
