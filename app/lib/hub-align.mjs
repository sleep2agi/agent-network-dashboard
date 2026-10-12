/**
 * Hub contract the dashboard actually sends (agent-network main, 2026-10-10).
 *
 * create-node runtimes are the seven names in server/src/create-node-validate.ts
 * `RUNTIMES`. The dashboard proxy used to allow only `claude-agent-sdk`,
 * `codex`, and `grok`. The wizard already sends `codex-sdk` and
 * `grok-build-acp`, so those creates died in this process with HTTP 400
 * and never reached the hub.
 *
 * Editable channels are telegram + feishu. `commhub` is the RPC transport
 * every node speaks; the hub's narrowChannelsPatch drops it, and a patch
 * whose every entry was invalid (`["commhub"]`) is `channels_all_invalid`,
 * not "disable all".
 */

export const HUB_CREATE_RUNTIMES = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', models: ['deepseek-v4-pro', 'MiniMax-M3', 'claude-sonnet-4-6', 'claude-opus-4-x'], defaultModel: 'claude-sonnet-4-6' },
  { id: 'claude-code-cli', label: 'Claude Code CLI', models: [], defaultModel: '' },
  { id: 'codex-sdk', label: 'Codex SDK', models: ['gpt-5.5'], defaultModel: 'gpt-5.5' },
  { id: 'codex-app-server', label: 'Codex App Server', models: [], defaultModel: '' },
  { id: 'grok-build-acp', label: 'Grok (build-acp)', models: ['grok-build'], defaultModel: 'grok-build' },
  { id: 'grok-build-cli', label: 'Grok CLI', models: [], defaultModel: '' },
  { id: 'opencode-cli', label: 'OpenCode', models: [], defaultModel: '' },
];

export const HUB_CREATE_RUNTIME_IDS = HUB_CREATE_RUNTIMES.map((r) => r.id);

/** Hub FLAG permissionMode enum. `auto` is rejected as flag_value_invalid. */
export const HUB_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

/** Flags the create proxy forwards. Unknown keys are flag_key_unknown on the hub. */
export const CREATE_FLAG_KEYS = ['permissionMode', 'maxTurns', 'budget', 'timeout'];

export const EDITABLE_CHANNELS = ['telegram', 'feishu'];

/**
 * Narrow a replace-set channel patch to what the hub will store.
 * `undefined` means the caller did not send channels (distinct from disable-all).
 * An array always returns an array, including `[]`.
 */
export function narrowEditableChannels(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) return undefined;
  const allow = new Set(EDITABLE_CHANNELS);
  const seen = new Set();
  const out = [];
  for (const entry of input) {
    if (typeof entry !== 'string') continue;
    const key = entry.trim().toLowerCase();
    if (!allow.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

const SECRET_FIELD = /api[_-]?key|secret|token|password|authorization|credential/i;
const SECRET_VALUE = /^(sk-|ntok_|utok_|atok_|ghp_|github_pat_|npm_|AKIA|xox[baprs]-)/;

function safeModelId(value, runtime) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (!id || id.length > 100) return '';
  if (SECRET_FIELD.test(id) || SECRET_VALUE.test(id)) return '';
  // Codex model ids are a single segment. A slash is an OpenCode provider/model,
  // and showing it as a Codex id would submit a shape that runtime does not use.
  if (runtime.startsWith('codex') && id.includes('/')) return '';
  return id;
}

function safeBaseUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return '';
  if (SECRET_FIELD.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.username || url.password) return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function collectModels(value, runtime, into) {
  if (typeof value === 'string') {
    const id = safeModelId(value, runtime);
    if (id) into.add(id);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.id === 'string') {
    const id = safeModelId(value.id, runtime);
    if (id) into.add(id);
  }
  if (typeof value.name === 'string' && value.name !== value.id) {
    const id = safeModelId(value.name, runtime);
    if (id) into.add(id);
  }
}

/**
 * Models and provider rows a daemon attached to one runtime via
 * `runtime_readiness[runtime]`. Network-wide provider lists are not read
 * here. Credential fields and credentialed base URLs are dropped.
 *
 * `present` is true only when that runtime's readiness object exists, so a
 * missing key stays "this daemon did not report" rather than "it reported
 * an empty catalog".
 */
export function reportedRuntimeCatalog(readiness, runtime) {
  const empty = { present: false, models: [], providers: [] };
  if (!readiness || typeof readiness !== 'object' || !runtime) return empty;
  const entry = readiness[runtime];
  if (!entry || typeof entry !== 'object') return empty;

  const models = new Set();
  for (const key of ['models', 'available_models']) {
    if (Array.isArray(entry[key])) {
      for (const item of entry[key]) collectModels(item, runtime, models);
    }
  }

  const providers = [];
  for (const key of ['providers', 'model_providers', 'available_providers']) {
    if (!Array.isArray(entry[key])) continue;
    for (const row of entry[key]) {
      if (!row || typeof row !== 'object') continue;
      const id = safeModelId(row.id || row.provider_id || row.name || '', runtime.startsWith('codex') ? 'other' : runtime);
      if (!id) continue;
      const rowModels = [];
      if (Array.isArray(row.models)) {
        for (const item of row.models) {
          collectModels(item, runtime, models);
          if (typeof item === 'string') {
            const mid = safeModelId(item, runtime);
            if (mid) rowModels.push(mid);
          } else if (item && typeof item === 'object') {
            const mid = safeModelId(item.id || item.name || '', runtime);
            if (mid) rowModels.push(mid);
          }
        }
      }
      const baseUrl = safeBaseUrl(row.base_url);
      providers.push({ id, ...(baseUrl ? { baseUrl } : {}), models: rowModels });
    }
  }

  return { present: true, models: [...models], providers };
}

/** User-facing readiness line. Only state/reason strings; nothing else is copied. */
export function readinessSummary(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const state = typeof entry.state === 'string' ? entry.state : '';
  const reason = typeof entry.reason === 'string' ? entry.reason : '';
  if (!state && !reason) return null;
  return { state, reason };
}
