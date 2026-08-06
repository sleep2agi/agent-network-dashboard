import assert from 'node:assert/strict';
import test from 'node:test';
import { HubDefinitiveError, HubDeliveryUnknownError, parseMcpResponse, sendWithIdempotentRecovery, withAbortTimeout } from '../../app/lib/hub-send-recovery.ts';

const mcp = (payload: unknown) => new Response(
  `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } })}\n\n`,
  { status: 200 },
);

test('parses the final SSE data frame without a greedy cross-frame match', () => {
  const raw = `event: ping\ndata: ${JSON.stringify({ ignored: true })}\n\nevent: message\ndata: ${JSON.stringify({ result: { content: [{ text: JSON.stringify({ ok: true, message_id: 'm1' }) }] } })}\n\n`;
  assert.deepEqual(parseMcpResponse(raw), { ok: true, message_id: 'm1' });
});

test('ambiguous first failure retries the exact same request and recovers', async () => {
  const seen: string[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    seen.push(String(init?.body));
    if (seen.length === 1) throw new Error('response lost after commit');
    return mcp({ ok: true, message_id: 'idem_1', idempotent_replay: true });
  };
  const result = await sendWithIdempotentRecovery({
    hubUrl: 'http://hub.test', headers: {}, body: '{"same":true}', fetchImpl: fakeFetch, timeoutMs: 100,
  });
  assert.deepEqual(result, { ok: true, message_id: 'idem_1', idempotent_replay: true, recovered: true });
  assert.deepEqual(seen, ['{"same":true}', '{"same":true}']);
});

test('two transport failures surface delivery_unknown instead of a false success', async () => {
  const fakeFetch: typeof fetch = async () => { throw new Error('hub down'); };
  await assert.rejects(
    sendWithIdempotentRecovery({ hubUrl: 'http://hub.test', headers: {}, body: '{}', fetchImpl: fakeFetch, timeoutMs: 100 }),
    (error: unknown) => error instanceof HubDeliveryUnknownError && error.message === 'hub down',
  );
});

test('a hung hub is aborted on both bounded attempts and remains delivery_unknown', async () => {
  let attempts = 0;
  const fakeFetch: typeof fetch = async (_url, init) => {
    attempts += 1;
    return await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  };
  const started = Date.now();
  await assert.rejects(
    sendWithIdempotentRecovery({ hubUrl: 'http://hub.test', headers: {}, body: '{}', fetchImpl: fakeFetch, timeoutMs: 10 }),
    error => error instanceof HubDeliveryUnknownError,
  );
  assert.equal(attempts, 2);
  assert.ok(Date.now() - started < 500, 'two bounded attempts must not hang indefinitely');
});

test('a definitive 4xx is returned after one attempt and is never retried', async () => {
  let attempts = 0;
  const fakeFetch: typeof fetch = async () => {
    attempts += 1;
    return new Response('forbidden', { status: 403 });
  };
  await assert.rejects(
    sendWithIdempotentRecovery({ hubUrl: 'http://hub.test', headers: {}, body: '{}', fetchImpl: fakeFetch }),
    error => error instanceof HubDefinitiveError && error.status === 403,
  );
  assert.equal(attempts, 1);
});

test('the network-scope fallback uses the same hard abort primitive', async () => {
  const started = Date.now();
  await assert.rejects(
    withAbortTimeout(10, signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })),
    error => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.ok(Date.now() - started < 500, 'scope lookup must not bypass the route time bound');
});
