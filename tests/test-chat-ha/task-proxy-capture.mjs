import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const port = Number(process.env.TEST459_FAKE_HUB_PORT || 9459);
const capture = process.env.TEST459_CAPTURE_FILE || '/tmp/test459-upstream-urls.txt';

createServer((req, res) => {
  appendFileSync(capture, `${req.method} ${req.url}\n`);
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/api/tasks')) {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const hasNetwork = url.searchParams.has('network_id');
    res.end(JSON.stringify(hasNetwork
      ? { ok: true, tasks: [], count: 0 }
      : {
          ok: true,
          tasks: [{
            task_id: 'older-same-second-a',
            from_name: 'human',
            to_name: 'agent / one',
            status: 'replied',
            content: 'older',
            created_at: '2026-08-09 11:22:33',
          }],
          count: 1,
        }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
}).listen(port, '127.0.0.1');
