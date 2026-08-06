# Contributing to Agent Network Dashboard

Thanks for helping improve the Dashboard.

Source development requires Node.js 22.12 or newer because the desktop build toolchain enforces that floor.

## Set up

```bash
git clone https://github.com/sleep2agi/agent-network-dashboard.git
cd agent-network-dashboard
cp .env.example .env.local
npm ci
npm run dev
```

Use a local or disposable CommHub. Never commit tokens, runtime state, production URLs, user data, or `.env.local`.

## Before opening a pull request

```bash
npm run lint
npm run build
npm run oss:check
npm run oss:secrets:history
npm run oss:surface
```

The history scan requires a full clone. If it reports a credential-shaped value, do not paste that value into an issue or PR; report only the commit and path, then follow [SECURITY.md](SECURITY.md).

## Workflow

1. Search existing issues.
2. Branch from `main`.
3. Keep each change focused and add tests for behavior changes.
4. Use a Conventional Commit subject (`fix:`, `feat:`, `docs:`, `test:`, or `chore:`).
5. Explain why the change is needed and include reproducible verification.

## Pull request checklist

- [ ] Lint, build, and relevant tests pass.
- [ ] User-visible behavior and configuration are documented.
- [ ] No secrets, private IPs, personal paths, production data, or generated runtime state are included.
- [ ] Security-sensitive changes include a negative test that fails when the guard is removed.
- [ ] Release notes are updated when appropriate.

## Reporting bugs and security issues

Use GitHub Issues for reproducible bugs and feature requests. Use GitHub Private Security Advisories for vulnerabilities or suspected credential exposure.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
