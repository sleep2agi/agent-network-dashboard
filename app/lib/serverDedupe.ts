/**
 * #157 RC#2 — host telemetry row dedup for the Servers panel.
 *
 * The CommHub /api/servers endpoint keys host telemetry by (hostname,
 * ip): a machine whose agents report over more than one interface
 * yields one row per IP. Live data caught `iZrj93pr2rcf5r2y9uo1oyZ`
 * twice — once at the Docker-bridge IP (carrying cpu/mem telemetry)
 * and once at loopback (telemetry null) — so the panel showed the same
 * physical host as two cards with split agent counts.
 *
 * Extracted from the /api/hub/servers route handler so the merge can
 * be unit-tested against a mock fixture independently of the proxy.
 */

export interface HubServerRow {
  hostname: string;
  ip?: string | null;
  agent_count?: number;
  cpu_load_1min?: number | null;
  cpu_cores?: number | null;
  mem_used_gb?: number | null;
  mem_total_gb?: number | null;
  mem_avail_gb?: number | null;
  disk_used_gb?: number | null;
  disk_total_gb?: number | null;
  cpu_history?: number[];
  mem_history?: number[];
  agents?: unknown[];
  last_seen?: string | null;
  status?: 'online' | 'offline';
  note?: string;
}

/**
 * Parse a hub timestamp to epoch ms. CommHub reports last_seen as
 * "YYYY-MM-DD HH:MM:SS" (space-separated, no timezone) — treat as UTC
 * so all clients agree regardless of local zone. ISO 8601 with an
 * explicit offset also parses cleanly (the +'Z' is only appended when
 * no zone is present). Returns NaN for missing / unparseable input.
 */
export function parseHubTime(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  return Date.parse(withTz);
}

/**
 * Collapse rows that share a hostname into one card.
 *
 * Dedup keys on hostname, not IP: a hostname is the machine identity,
 * whereas an IP can be shared across hosts behind NAT (two distinct
 * hostnames can surface as the same public IP) or differ per interface
 * on one host. Merge rule for a multi-row hostname:
 *   - agent_count  = sum across rows (one host's total fan-out)
 *   - telemetry    = freshest-non-null per field — walk rows newest
 *                    last_seen first, take the first row that actually
 *                    reports each field, so a stale-but-telemetried row
 *                    still contributes cpu/mem when the freshest row's
 *                    values are null
 *   - last_seen    = newest across rows
 *   - agents[]     = union, dedup by alias
 *
 * Sentinel hostnames that are not real identities — empty or the
 * literal "unknown" the hub emits when an agent never resolved its
 * host — are passed through untouched: merging two distinct unknown
 * machines into one card would be worse than showing both.
 */
export function dedupeByHostname(rows: HubServerRow[]): HubServerRow[] {
  const groups = new Map<string, HubServerRow[]>();
  const passthrough: HubServerRow[] = [];
  for (const row of rows) {
    const h = row.hostname;
    if (!h || h === 'unknown') { passthrough.push(row); continue; }
    const bucket = groups.get(h) ?? [];
    bucket.push(row);
    groups.set(h, bucket);
  }
  const merged: HubServerRow[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length === 1) { merged.push(bucket[0]); continue; }
    // Freshest last_seen first. NaN (missing timestamp) sorts last.
    const sorted = [...bucket].sort((a, b) => {
      const ta = parseHubTime(a.last_seen), tb = parseHubTime(b.last_seen);
      return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
    });
    const coalesce = <K extends keyof HubServerRow>(key: K): HubServerRow[K] | undefined => {
      for (const r of sorted) {
        const v = r[key];
        if (v != null) return v;
      }
      return undefined;
    };
    const agentMap = new Map<string, unknown>();
    for (const r of sorted) {
      if (!Array.isArray(r.agents)) continue;
      for (const a of r.agents) {
        const key = (a as { alias?: string })?.alias ?? JSON.stringify(a);
        if (!agentMap.has(key)) agentMap.set(key, a);
      }
    }
    merged.push({
      hostname: sorted[0].hostname,
      ip: coalesce('ip') ?? null,
      agent_count: bucket.reduce((sum, r) => sum + (r.agent_count ?? 0), 0),
      cpu_load_1min: coalesce('cpu_load_1min') ?? null,
      cpu_cores: coalesce('cpu_cores') ?? null,
      mem_used_gb: coalesce('mem_used_gb') ?? null,
      mem_total_gb: coalesce('mem_total_gb') ?? null,
      mem_avail_gb: coalesce('mem_avail_gb') ?? null,
      disk_used_gb: coalesce('disk_used_gb') ?? null,
      disk_total_gb: coalesce('disk_total_gb') ?? null,
      cpu_history: coalesce('cpu_history'),
      mem_history: coalesce('mem_history'),
      agents: agentMap.size > 0 ? [...agentMap.values()] : undefined,
      last_seen: coalesce('last_seen') ?? null,
      status: coalesce('status'),
      note: coalesce('note'),
    });
  }
  return [...merged, ...passthrough];
}
