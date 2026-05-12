/** Round 82: strip the most common markdown markup from agent-to-agent
 *  task / message bodies so single-line table previews read cleanly.
 *  Full original content stays in the expanded row / drawer / title=. */
export function previewContent(raw: string | null | undefined): string {
  if (!raw) return '--';
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')   // images: ![alt](src) → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')    // links:  [text](href) → text
    .replace(/`([^`]+)`/g, '$1')                // inline code: `x` → x
    .replace(/\s+/g, ' ')                       // collapse whitespace
    .trim() || '--';
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return '--';
  const diff = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function statusColor(status: string, hasSse: boolean): string {
  if (hasSse && status === 'working') return 'bg-green-500';
  if (hasSse && status === 'idle') return 'bg-emerald-400';
  if (hasSse) return 'bg-blue-400';
  if (status === 'offline') return 'bg-gray-500';
  return 'bg-yellow-400';
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
