# Agent Network Dashboard

Web, desktop, and mobile UI for an [Agent Network](https://anet.sh) CommHub. It provides authenticated views for chat, tasks, nodes, messages, networks, logs, and administration.

The public source repository is named `agent-network-dashboard-oss`. The established npm package remains `@sleep2agi/agent-network-dashboard` for compatibility with existing installations and CLI integrations.

## Quick start

The supported path is through the Agent Network CLI:

```bash
npm install -g @sleep2agi/agent-network

# Terminal 1
anet hub start

# Terminal 2
anet hub dashboard
```

Open <http://127.0.0.1:3000>. Change bootstrap credentials before exposing CommHub beyond localhost.

## Develop from source

Development requirements: Node.js 22.12 or newer, npm, and a reachable CommHub. The published web launcher itself supports Node.js 20 or newer; the higher development floor comes from the Electron build toolchain.

```bash
git clone https://github.com/sleep2agi/agent-network-dashboard-oss.git
cd agent-network-dashboard-oss
cp .env.example .env.local
npm ci
npm run dev
```

The default configuration talks to a local Hub and binds the development server locally. Keep real credentials in `.env.local`; all `.env*` files except `.env.example` are ignored.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `COMMHUB_URL` | `http://127.0.0.1:9200` | CommHub base URL |
| `PORT` | `3000` | Dashboard port |
| `HOST` | operating-system `HOSTNAME`, otherwise `127.0.0.1` | Explicit listen host for the packaged launcher; set it deliberately |
| `DASHBOARD_PASSWORD` | unset | Optional standalone login password |

When `DASHBOARD_PASSWORD` is unset, authentication is delegated to CommHub. For any non-local deployment, use TLS, set explicit credentials, and place the service behind an authenticated reverse proxy or equivalent access control.

## Architecture

```text
Browser
  |-- /api/hub/*  -- REST --> CommHub /api/*
  |-- event stream ---------> CommHub SSE
  `-- session cookie -------> Dashboard server routes
```

The Dashboard is stateless. CommHub owns users, nodes, tasks, messages, and persistence.

## Quality and security gates

```bash
npm run lint
npm run build
npm run oss:check
npm run oss:secrets:history
npm run oss:surface
```

`oss:secrets:history` scans every fetched branch history, not only the current working tree. `oss:surface` checks tracked portability markers and GitHub-hosted issue/PR content while explicitly reporting surfaces it cannot attest. See [OSS security gates](docs/oss-security-gates.md).

## Contributing and security

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [OSS security gates](docs/oss-security-gates.md)

Please report vulnerabilities through GitHub Private Security Advisories, not public issues.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
