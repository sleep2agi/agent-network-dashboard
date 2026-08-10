import { createServer } from 'node:http';

const calls = [];
const token = 'utok_test690_owner_1234567890';
createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/api/auth/login' && req.method === 'POST') return json(200, { ok: true, token, user: { user_id: 'u_owner' }, network_id: 'net_demo' });
  if (req.url === '/api/auth/me' && req.headers.authorization === `Bearer ${token}`) return json(200, { ok: true, networks: [{ network_id: 'net_demo' }] });
  if (req.url === '/calls') return json(200, { calls });
  if (req.url === '/reset' && req.method === 'POST') { calls.splice(0); return json(200, { ok: true }); }
  if (req.url === '/api/nodes/n_owner_schedule/external-schedule-edits' && req.method === 'POST') {
    calls.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
    return json(202, { ok: true, intent: { intent_id: 'sei_proxy' } });
  }
  return json(404, { ok: false, error: 'not_found' });
}).listen(9999, '127.0.0.1');
