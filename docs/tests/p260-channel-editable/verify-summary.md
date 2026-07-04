# #260 channel edit — dashboard live verify

Two-part verification against the branch `feature/260-channel-editable`:

## 1. API whitelist round-trip (real dashboard route + mock hub)

A tiny mock hub was pointed at `127.0.0.1:9299` via `COMMHUB_URL`, so the
dashboard route forwards its whitelisted payload there and we can inspect
exactly what would reach the real hub.

**Client POST (via authenticated curl)** — intentionally hostile input:

```json
{
  "node_id": "demo-node",
  "model": "claude-sonnet-4-6",
  "channels": [
    "telegram", "FEISHU", "evil-hacker", "telegram",
    "wechat", "commhub", 42, "telegram; drop table users;"
  ],
  "flags": {
    "permissionMode": "default",
    "dangerouslySkipPermissions": true,
    "maliciousField": "pwned"
  }
}
```

**Payload the mock hub captured** (post-whitelist):

```
[mock-hub] POST /api/nodes/config — payload: {"node_id":"demo-node",
  "model":"claude-sonnet-4-6",
  "flags":{"permissionMode":"default","dangerouslySkipPermissions":true},
  "channels":["telegram","feishu","commhub"]}
```

Whitelist scoreboard:

| Input                                | Output       | Reason                                    |
|--------------------------------------|--------------|-------------------------------------------|
| `"telegram"`                         | `telegram`   | in EDITABLE_CHANNELS                      |
| `"FEISHU"`                           | `feishu`     | case-folded                               |
| `"evil-hacker"`                      | dropped      | not in EDITABLE_CHANNELS                  |
| `"telegram"` (duplicate)             | dedup'd      | Set filter                                |
| `"wechat"`                           | dropped      | roadmap-only, not in EDITABLE_CHANNELS    |
| `"commhub"`                          | `commhub`    | in EDITABLE_CHANNELS                      |
| `42`                                 | dropped      | `typeof !== "string"`                     |
| `"telegram; drop table users;"`      | dropped      | not exact key match                       |
| `flags.maliciousField`               | dropped      | not in EDITABLE_FLAGS                     |
| `flags.dangerouslySkipPermissions`   | passed       | in EDITABLE_FLAGS                         |

## 2. End-to-end panel drive (headless Chromium, prod build)

Ran a Playwright pass against `next start` + a synthetic `Session` mounted
via a temporary verify harness (removed from the diff before commit).
Captured:

- `260-before.png` — panel opened, load effect resolved
  (`GET /api/anet/node-config → 200`), all three editable channels
  disabled=false; WeChat still greyed (roadmap).
- `260-toggled.png` — clicked Feishu on → `feishu.checked = true`,
  `dirty = true`, save button label flipped from `无改动` to `保存设置`.
- `260-applied.png` — Save posted through; apply lifecycle strip shows
  `✓ 已应用（模拟 · 后端未接入，未真正下发）` — mock fallback flavour, as
  expected because the mock hub returned 404 on `/api/nodes/config`.
- `260-channels.png` — enabled Feishu row expanded to show the masked
  per-channel StubField values (`App ID: cli_••••••`, `App Secret: ••••••`,
  allowFrom/allowChats/mention). These stay read-only. Footer copy makes
  the contract explicit: "勾选启用/关闭该 Channel；per-channel 的 token /
  secret / allowFrom 仍保存在节点本地 config.json，不在此处编辑。"

## Red-line 3-layer audit

- Broad private-fork keyword regex on diff = 0 hits
- Slug regex `\[\[[a-zA-Z0-9_-]+\]\]` on diff + commit msg = 0 hits
- Real vendor key literal regex on diff + captured payload = 0 hits
- Screenshots contain masked field displays only; no plaintext secret
