import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/hub/tasks/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function request(query, responses) {
  const calls = [];
  const exports = {};
  new Function('require', 'exports', 'fetch', 'process', compiled)(
    () => ({ requireDashboardAuth: async () => null, getV3UserToken: async () => 'fixture-token' }),
    exports,
    async (url, init) => {
      calls.push({ url: new URL(url), init });
      const response = responses.shift();
      if (!response) throw new Error('Unexpected fallback');
      return response;
    },
    { env: { COMMHUB_URL: 'http://fixture.invalid' } },
  );
  const response = await exports.GET(new Request(`http://dashboard.invalid/api/hub/tasks?${query}`));
  return { response, body: await response.json(), calls };
}

describe('task proxy preserves auth/permission boundaries', () => {
  test('primary 403 stays permission denied, with no fallback or body parsing assumption', async () => {
    const { response, body, calls } = await request('network_id=B&to_name=target', [new Response('Forbidden', { status: 403 })]);
    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0].url.searchParams.get('network_id')).toBe('B');
    expect(calls[0].url.searchParams.get('to_name')).toBe('target');
  });
  test('unscoped legacy fallback also preserves 403', async () => {
    const { response, body, calls } = await request('limit=20', [new Response('', { status: 404 }), new Response('Forbidden', { status: 403 })]);
    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(calls.map(call => call.url.pathname)).toEqual(['/api/tasks', '/api/completions']);
  });
  test('401 still wins over missing endpoint fallback', async () => {
    const { response, calls } = await request('network_id=A', [new Response('Expired', { status: 401 })]);
    expect(response.status).toBe(401);
    expect(calls.length).toBe(1);
  });
  test('scoped old Hub never uses unscoped completions', async () => {
    const { response, body, calls } = await request('network_id=B', [new Response('', { status: 404 })]);
    expect(response.status).toBe(501);
    expect(body.error).toBe('hub_tasks_scope_unsupported');
    expect(calls.length).toBe(1);
  });
});
