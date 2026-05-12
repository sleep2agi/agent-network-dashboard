# @sleep2agi/agent-network-dashboard

Web UI for an Agent Network — real-time chat, tasks, messages, nodes, networks, logs, and admin views over a CommHub server.

**v0.1.0 stable.** Pairs with `@sleep2agi/commhub-server` 0.5.0 and `@sleep2agi/agent-network` 2.0.0. The verified path is to launch via the `anet` CLI.

## Verified launch

```bash
npm install -g @sleep2agi/agent-network

# Terminal 1 — hub
anet hub start
#   • http://127.0.0.1:9200
#   • SQLite at ~/.commhub/commhub.db
#   • Default admin auto-created: admin / anethub

# Terminal 2 — dashboard
anet hub dashboard
#   • http://localhost:3000
```

Open the browser, log in with `admin / anethub`, and you have the full UI: Chat / Nodes / Tasks / Messages / Networks / Logs / Admin / Docs.

## Verified features

- **Chat panel** — markdown rendering (GFM tables, fenced code), Enter to send, Shift+Enter for newline
- **Optimistic echo** — your own message renders instantly, before the server ack
- **Source labels** — bubbles tagged `You` or `↳ <agent-alias>` so you can tell speakers apart
- **Persistent history** — chat stays after a page reload
- **Failure rendering** — network blips, server hiccups, expired tokens all render an error bubble (no white screen)
- **Multi-agent visibility** — when one agent dispatches a sub-task to a peer, the handshake shows up in the Tasks and Messages pages live
- **LAN-shared hub** — point the dashboard at any reachable hub via `COMMHUB_URL`

## Direct invocation

```bash
COMMHUB_URL=http://127.0.0.1:9200 npx @sleep2agi/agent-network-dashboard
```

## From source

```bash
git clone https://github.com/sleep2agi/agent-network-dashboard
cd agent-network-dashboard
npm install
npm run dev
```

## Environment

| Variable | Default | Notes |
|---|---|---|
| `COMMHUB_URL` | `http://127.0.0.1:9200` | hub address |
| `PORT` | `3000` | dashboard listen port |
| `DASHBOARD_PASSWORD` | (none) | optional gate for standalone deploys |

If `DASHBOARD_PASSWORD` is unset the dashboard reuses the hub's user system (login as the default `admin / anethub`, or any account you've created via `anet register`).

## Data flow

```
Browser ──┬─ /api/hub/*          → fetch  → CommHub REST (/api/*)
          ├─ SSE long-poll       → CommHub /events/:alias
          └─ cookie-based utok_  → issued by hub login, dashboard transparently relays
```

The dashboard is stateless — all persistence lives in the hub's SQLite (`~/.commhub/commhub.db`).

## Not verified

- Standalone deployment with `DASHBOARD_PASSWORD` against a remote hub on the public internet (works in dev, no production E2E in v2.0.0).
- Network management UI (multi-network create / invite / member roles) — page exists, the underlying APIs are not E2E regressed.

## Related

| | |
|---|---|
| npm | [@sleep2agi/agent-network-dashboard](https://www.npmjs.com/package/@sleep2agi/agent-network-dashboard) (0.1.0) |
| Hub | [@sleep2agi/commhub-server](https://www.npmjs.com/package/@sleep2agi/commhub-server) (0.5.0) |
| CLI | [@sleep2agi/agent-network](https://www.npmjs.com/package/@sleep2agi/agent-network) (2.0.0) |
| Agent | [@sleep2agi/agent-node](https://www.npmjs.com/package/@sleep2agi/agent-node) (2.1.1) |
| Docs | https://anet.vansin.me |

## License

MIT
