// 节点「职责介绍 / 个性签名」单行摘要格式化（#5501，与 agent-network-app/src/node-description.ts 同口径）。
const TEMPLATE_LINE_RE = /^(负责|能干什么|什么事找我|不做|职责|简介|个性签名|签名)[：:]\s*(.*)$/;

export function descriptionSummary(raw: string | null | undefined, maxLen = 80): string {
  const text = (raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';
  let picked = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = TEMPLATE_LINE_RE.exec(line);
    const body = (m ? m[2] : line).replace(/\s+/g, ' ').trim();
    if (body) { picked = body; break; }
  }
  if (!picked) return '';
  if (maxLen > 1) {
    const chars = [...picked];
    if (chars.length > maxLen) return chars.slice(0, maxLen - 1).join('') + '…';
  }
  return picked;
}
