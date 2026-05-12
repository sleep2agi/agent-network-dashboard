# Dashboard OSS Readiness Report

**Repo**: `sleep2agi/agent-network-dashboard`
**Scan date**: 2026-05-12
**Auditor**: N站马 (Dashboard owner)
**Status of repo at scan time**: pre-public, npm package already public under preview tag

---

## TL;DR

The repo was scanned for credentials, personal info, license issues, debug
residue, security holes, and dependency posture. **One P0 issue was found
(a leaked GitHub PAT in older git history) and resolved by force-pushing a
fresh single-commit history (Vincent-approved nuclear option).** Remaining
items are P1/P2 polish.

Repo is **OSS-ready** once the leaked PAT is revoked at the GitHub side
(rotation is on Vincent's checklist — history wipe alone doesn't help users
who already cloned the leak).

---

## 🚨 P0 — Resolved

### P0-1. Leaked GitHub PAT in git history

- **Token**: `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`
- **Surface**: `.anet/nodes/N站牛/logs/2026-04-10.log` (agent inter-comm log
  that captured the token verbatim in a CommHub message body when 通信龙
  asked N站牛 to push a doc on his behalf).
- **Reachable in commits**: `14707aa` (added) and `e13a382` (deleted).
  Even though the file was deleted in `e13a382`, `git log -p` on any clone
  prior to history wipe could recover it.
- **Resolution** (this scan): Vincent approved nuclear option ("可以清空
  commit 然后 init push -f"). Executed `git bundle create
  /tmp/anet-dashboard-pre-wipe.bundle --all` for backup, then `rm -rf .git
  && git init -b main && git add . && git commit && git push -f origin
  main`. New initial commit `2aa6e95` is now the entire history; the old
  graph is unreachable from `sleep2agi/agent-network-dashboard`.
- **Outstanding action (Vincent)**: revoke the PAT at
  https://github.com/settings/tokens. The token's bytes still live in
  clones that pre-date the wipe and in the local backup bundle; only an
  upstream revoke makes the credential dead. Earlier attempts to use the
  token from our dev box returned "No such device or address" which
  suggests it may already be inactive, but explicit revocation is the
  belt-and-suspenders move before OSS.

### P0-2. `.anet/` runtime directory contained tokens

- **What**: The working tree's `.anet/.env` holds
  `COMMHUB_TOKEN=ntok_f347c879b5cb4d23a89f5c4e56b21219` (current dev hub
  service token). The full `.anet/` directory holds per-node configs,
  session state, telegram channel inboxes, and dev logs.
- **Surface**: `.anet/` is gitignored in HEAD's `.gitignore` and was
  removed from git history by the wipe. Working tree only.
- **Resolution**: `.gitignore` covers `.anet/` and `.npmignore` excludes
  it. No follow-up code change needed in this audit.

---

## ⚠️ P1 — OSS-blocking polish

### P1-1. `npm audit` — 2 vulnerabilities

```
postcss <8.5.10  — moderate (XSS via Unescaped </style>)
next 16.2.3      — high (transitive via postcss; fixable by next@16.2.6)
```

- **Fix path**: `npm audit fix --force` will bump Next to 16.2.6.
- **Risk**: out-of-stated-dep-range jump; test the dashboard end-to-end
  after the bump before promoting to a stable release.
- **Recommendation**: do this in `0.4.5-preview.0`, NOT in 0.4.4-preview.0
  (don't mix CVE fix and design polish in one preview, that complicates
  diff review).

### P1-2. TopoGraph still dark in light theme (GitHub issue #8)

- **What**: `app/components/TopoGraph.tsx` SVG bg is `<linearGradient>
  #0b1220→#080814→#101018` regardless of theme. In Light/Mint, the
  visualization is a black square inside an otherwise white page.
- **Why P1 not P0**: cosmetic, not a security/credential issue.
- **Fix**: render a light-theme variant SVG (white bg + light-grey grid +
  emerald node circles, no glow filter). ~150 LOC. Scheduled for
  `0.4.5-preview.0`.

### P1-3. README minimum bar

- **What**: README.md exists (3.3KB) and covers install, usage, ENV vars.
- **Gap for OSS**: no architecture overview, no contribution flow link
  (CONTRIBUTING.md exists separately but README doesn't link it), no
  screenshot/demo GIF, no "what is anet" context for first-time readers.
- **Recommendation**: README expansion in `0.4.5-preview.0` or as its own
  small commit between previews. Not a publish blocker.

### P1-4. Hardcoded `console.warn` in production code

- `app/lib/dashboard-auth.ts:37` — `console.warn('[dashboard] WARNING:
  using CommHub token as login password. Set DASHBOARD_PASSWORD for
  security.')`
- This warning is legitimate (security-relevant configuration drift) and
  intentionally guarded by `process.env._DASHBOARD_TOKEN_WARN_SHOWN` to
  fire once per process. Keep.

---

## ℹ️ P2 — Nice-to-have

### P2-1. `dangerouslySetInnerHTML` in layout.tsx

- `app/layout.tsx:49` — inline boot script that reads `localStorage` to
  apply the persisted theme before React hydrates.
- The script is a static literal (`themeBootScript` constant) with no
  interpolated user input. Safe.

### P2-2. Hardcoded `127.0.0.1:9200` defaults

- Six route files default `HUB_URL` to `http://127.0.0.1:9200` when
  `COMMHUB_URL` env is not set.
- This is the documented behavior for `npx
  @sleep2agi/agent-network-dashboard` against a local CommHub. Not
  sensitive; keep.

### P2-3. Author / homepage personal-ish

- `package.json`: `"author": "sleep2agi"`, `"homepage":
  "https://anet.sh"`. Both are project-level, not personal.
- `README.md`: `Docs | https://anet.vansin.me`. This is Vincent's
  personal subdomain. Recommend swapping to `https://docs.anet.sh` or
  similar project domain when available.

### P2-4. Dependency license posture

```
MIT:               115
Apache-2.0:         10
ISC:                 3
LGPL-3.0-or-later:   2
CC-BY-4.0:           1
BSD-3-Clause:        1
0BSD:                1
```

- **LGPL-3.0-or-later** (2 packages) is the only concern under
  Apache-2.0. LGPL is GPL-family with a linking exception; combining
  dynamically-linked LGPL with Apache-2.0 is generally accepted but
  worth a one-time formal review by Vincent.
- No GPL/AGPL pure-strong-copyleft deps detected.

### P2-5. Test artifacts

- `test-results/.last-run.json` was in the working tree (and in the
  initial commit). It's gitignored going forward via the updated
  `.gitignore`. Low-risk leaked dev metadata.

### P2-6. Public domain alignment

- Dashboard binds to `0.0.0.0:3000` by default (per `bin/start.js`).
  Reasonable for a self-hosted dev tool; document that production
  deployments should sit behind auth + TLS (already noted in README's
  ENV section).

---

## Scan methodology

1. **Git history credential sweep** (now applied to the FRESH history
   only, since old history was wiped):
   ```bash
   git log -p --all | grep -iE 'ghp_|github_pat_|sk-|api[-_ ]?key|secret|password=|token=|AKIA|AIza|npm_'
   git log -p --all | grep -iE 'ntok_[a-f0-9]{16,}|utok_[a-f0-9]{16,}|atok_[a-f0-9]{16,}'
   ```
2. **Personal info**: `grep -rE "vansin|sleep2agi|msnode|wechat|feishu" --exclude-dir={node_modules,.next,.git,.anet}`
3. **License**: `LICENSE` file present + `package.json` `license` field +
   `npx license-checker --production --summary` for transitive deps.
4. **Security primitives**: hand-grep `dangerouslySetInnerHTML`, native
   `<select>`, hardcoded URLs/IPs, debug `console.log` patterns.
5. **Dependency vulns**: `npm audit --omit=dev`.

---

## Sign-off

The repo at commit `2aa6e95` is **OSS-publishable** under Apache-2.0
provided Vincent confirms the leaked PAT (`ghp_L9j2A…`) is revoked
upstream. Remaining items (P1-1 npm audit, P1-2 TopoGraph light variant,
P1-3 README polish) are ship-it-anyway-and-iterate-later items, not
publish blockers.
