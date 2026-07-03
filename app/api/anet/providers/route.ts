import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Model-provider registry proxy (RFC-028 P1 — aligned to the real #308 schema,
 * commit f32725e; 通信龙 gap-A ruling commhub 1e451a0f).
 *
 *   GET  → list_providers, mapped to the UI shape (vendor→type, models objects
 *          → model_name strings, in_vault→hasKey).
 *   POST → create only: secret-FIRST. The vault key must exist before the
 *          provider, so we upsert_network_secret (UPPERCASE-regex key derived
 *          from the name) then upsert_provider (vendor + models as objects).
 *          A key is REQUIRED on create (the backend rejects providers whose
 *          secret_key_ref is not in the vault).
 *   DELETE / edit → NOT wired: #308's upsert_provider is INSERT-only with no
 *          enabled arg and there is no update_provider / set_provider_enabled
 *          tool (P1.5 follow-up). The UI edit/disable/delete controls are
 *          disabled placeholders; this route reports `unsupported` if called.
 *
 * Keys are WRITE-ONLY (vault); never returned to the client. Hub-without-RFC-028
 * → flagged `unconfirmed` (no fake success). MOCK_PROVIDERS=1 → env-gated
 * contract-fixture (schema-shaped) for preview; off in production.
 */

const VENDORS = ['openai-compatible', 'anthropic', 'grok', 'custom'] as const;

interface ProviderInput {
  name: string;
  type: string;      // UI label for `vendor`
  base_url: string;
  models: string[];  // UI: model name strings
  apiKey?: string;   // write-only
}

// UPPERCASE secret-key ref derived from provider name (matches the backend
// regex /^[A-Z][A-Z0-9_]{0,63}$/): "OpenAI" → "PROVIDER_OPENAI_KEY".
function secretKeyFor(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'PROVIDER';
  const ref = `PROVIDER_${slug}_KEY`;
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(ref) ? ref : `PROVIDER_${Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '')}_KEY`;
}

// Anthropic-compatible covers Claude + DeepSeek (api.deepseek.com/anthropic)
// + MiniMax (api.minimax.chat/anthropic) etc. via custom base_url — preview
// reflects that real coverage.
function mockProviders() {
  // All three live after #320 (SSRF allowlist: anthropic / deepseek /
  // minimax.chat / minimax.io).
  return [
    { provider_id: 'prov_claude', name: 'Claude (Anthropic)', type: 'anthropic', base_url: 'https://api.anthropic.com', models: ['claude-opus-4-x', 'claude-sonnet-4-6'], enabled: true, hasKey: true },
    { provider_id: 'prov_deepseek', name: 'DeepSeek', type: 'anthropic', base_url: 'https://api.deepseek.com/anthropic', models: ['deepseek-v4-pro'], enabled: true, hasKey: true },
    { provider_id: 'prov_minimax', name: 'MiniMax', type: 'anthropic', base_url: 'https://api.minimax.chat/anthropic', models: ['MiniMax-M3'], enabled: false, hasKey: true },
  ];
}

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  if (process.env.MOCK_PROVIDERS === '1') {
    return Response.json({ ok: true, mock: true, providers: mockProviders() });
  }

  const networkId = await resolveDefaultNetworkId();
  const args = networkId ? { network_id: networkId } : {};
  try {
    const res = await callMcp('list_providers', args);
    if (res.status === 404 || res.status === 501) {
      return Response.json({ ok: false, unconfirmed: true, providers: [], error: 'hub lacks RFC-028 list_providers (needs #308 + hub upgrade)' }, { status: 200 });
    }
    if (!res.ok) return Response.json({ ok: false, error: `hub ${res.status}`, providers: [] }, { status: 502 });
    const result = (await parseMcpEnvelope(res)) as { ok?: boolean; providers?: unknown[]; error?: string };
    if (result?.ok === false) return Response.json({ ok: false, error: result.error || 'list_failed', providers: [] }, { status: 502 });

    // Map the real shape → UI shape.
    const providers = (Array.isArray(result?.providers) ? result.providers : []).map((p) => {
      const pp = p as Record<string, unknown>;
      const models = Array.isArray(pp.models) ? (pp.models as Array<Record<string, unknown>>).map(m => String(m.model_name || '')).filter(Boolean) : [];
      return {
        provider_id: pp.provider_id,
        name: pp.name,
        type: pp.vendor,            // vendor → type (UI label)
        base_url: pp.base_url,
        models,
        enabled: pp.enabled === undefined ? true : !!pp.enabled,
        hasKey: pp.in_vault === undefined ? true : !!pp.in_vault,
      };
    });
    return Response.json({ ok: true, providers });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), providers: [] }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: Partial<ProviderInput> & { provider_id?: string; network_id?: string; enabled?: boolean };
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }

  // Edit path (RFC-028 P1.5, #317 update_provider — patch semantics; vendor /
  // secret / network are immutable; changing the key goes via the secret-first
  // create flow, not here).
  if (body.provider_id) {
    if (process.env.MOCK_PROVIDERS === '1') return Response.json({ ok: true, mock: true, provider_id: body.provider_id });
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.base_url !== undefined) patch.base_url = String(body.base_url).trim();
    if (Array.isArray(body.models)) patch.models = body.models.map(m => String(m).trim()).filter(Boolean).map(m => ({ model_name: m }));
    if (body.enabled !== undefined) patch.enabled = !!body.enabled;
    if (!Object.keys(patch).length) return Response.json({ ok: false, error: 'no fields to update' }, { status: 400 });
    const networkId = body.network_id || (await resolveDefaultNetworkId());
    try {
      const res = await callMcp('update_provider', { provider_id: body.provider_id, ...(networkId ? { network_id: networkId } : {}), patch });
      if (res.status === 404 || res.status === 501) return Response.json({ ok: false, unconfirmed: true, error: 'hub lacks update_provider (needs #317)' }, { status: 200 });
      const result = (await parseMcpEnvelope(res)) as { ok?: boolean; error?: string };
      if (result?.ok === false) {
        // a no-op patch is benign, not a failure.
        if (result.error === 'no_changes' || result.error === 'noop_no_changes') return Response.json({ ok: true, no_changes: true });
        return Response.json({ ok: false, error: result.error || 'update_failed' }, { status: 502 });
      }
      return Response.json({ ok: true, provider_id: body.provider_id });
    } catch (e: unknown) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  const name = (body.name || '').toString().trim();
  if (!name) return Response.json({ error: 'name required' }, { status: 400 });
  const vendor = (body.type || 'openai-compatible').toString();
  if (!VENDORS.includes(vendor as (typeof VENDORS)[number])) {
    return Response.json({ error: `type must be one of: ${VENDORS.join(', ')}` }, { status: 400 });
  }
  const base_url = (body.base_url || '').toString().trim();
  if (!base_url) return Response.json({ error: 'base_url required' }, { status: 400 });
  const modelNames = Array.isArray(body.models) ? body.models.map(m => String(m).trim()).filter(Boolean) : [];
  const apiKey = (body.apiKey || '').toString();
  // secret-first: the backend requires secret_key_ref to already be in the vault.
  if (!apiKey) return Response.json({ ok: false, error: 'API key 必填（供应商创建需先写入密钥库）' }, { status: 400 });

  if (process.env.MOCK_PROVIDERS === '1') {
    return Response.json({ ok: true, mock: true, provider_id: `prov_mock_${Date.now().toString(36)}` });
  }

  const networkId = body.network_id || (await resolveDefaultNetworkId());
  const netArg = networkId ? { network_id: networkId } : {};
  const secret_key_ref = secretKeyFor(name);

  try {
    // 1) vault the key (OWNER-only on the hub side).
    const sres = await callMcp('upsert_network_secret', { ...netArg, key: secret_key_ref, value: apiKey });
    if (sres.status === 404 || sres.status === 501) {
      return Response.json({ ok: false, unconfirmed: true, error: 'hub lacks RFC-028 upsert_network_secret (needs #308)' }, { status: 200 });
    }
    const sresult = (await parseMcpEnvelope(sres)) as { ok?: boolean; error?: string };
    if (sresult?.ok === false) {
      return Response.json({ ok: false, error: sresult.error || 'secret_write_failed', detail: 'vault 写入失败（可能需 OWNER 角色）' }, { status: 502 });
    }
    // 2) create the provider referencing the vault key + models as objects.
    const models = modelNames.map(m => ({ model_name: m }));
    const pres = await callMcp('upsert_provider', { ...netArg, name, vendor, base_url, secret_key_ref, models });
    if (pres.status === 404 || pres.status === 501) {
      return Response.json({ ok: false, unconfirmed: true, error: 'hub lacks RFC-028 upsert_provider (needs #308)' }, { status: 200 });
    }
    const presult = (await parseMcpEnvelope(pres)) as { ok?: boolean; error?: string; provider_id?: string };
    if (presult?.ok === false) return Response.json({ ok: false, error: presult.error || 'upsert_failed', result: presult }, { status: 502 });
    return Response.json({ ok: true, provider_id: presult?.provider_id });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get('id');
  if (!providerId) return Response.json({ error: 'id required' }, { status: 400 });
  if (process.env.MOCK_PROVIDERS === '1') return Response.json({ ok: true, mock: true });
  // Soft-delete = update_provider{enabled:false} (#317; no delete_provider).
  const networkId = await resolveDefaultNetworkId();
  try {
    const res = await callMcp('update_provider', { provider_id: providerId, ...(networkId ? { network_id: networkId } : {}), patch: { enabled: false } });
    if (res.status === 404 || res.status === 501) return Response.json({ ok: false, unconfirmed: true, error: 'hub lacks update_provider (needs #317)' }, { status: 200 });
    const result = (await parseMcpEnvelope(res)) as { ok?: boolean; error?: string };
    if (result?.ok === false && result.error !== 'no_changes') return Response.json({ ok: false, error: result.error || 'disable_failed' }, { status: 502 });
    return Response.json({ ok: true });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
