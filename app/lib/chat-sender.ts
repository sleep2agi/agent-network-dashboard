// 会话里「这句是谁说的」——唯一的判定口径。
//
// 背景（#35）：`tasks.from_name` 的默认值就是 `hub`。Hub 自己发的广播与
// 系统通知走这条路径，之前被和 `Dashboard`/`api` 一起归成「You」，于是
// 别人说的话被读成用户自己说的（App 侧 #122 是同一类）。
//
// `Dashboard` 与 `api` 是本客户端的两个身份标签（server/src/rest-identity.ts
// 把用户令牌解析成 `requested || authenticatedUsername || "api"`），归成
// 「You」是对的；`hub` 不是。

const OWN_SENDERS = new Set(['dashboard', 'api']);

/** 这条消息是「我」发的吗？空 from_name 仍按本机默认发送者处理。 */
export function isOwnSender(fromName?: string | null): boolean {
  if (!fromName) return true;
  return OWN_SENDERS.has(String(fromName).trim().toLowerCase());
}

/** 谁来显示这个名字。系统发送者给人看的称呼（hub → Hub）。 */
const DISPLAY_NAMES: Record<string, string> = { hub: 'Hub' };

export function senderLabelFor(fromName?: string | null): string {
  if (isOwnSender(fromName)) return 'You';
  const raw = String(fromName ?? '').trim();
  return DISPLAY_NAMES[raw.toLowerCase()] ?? raw;
}
