# Wizard model-default fix verify

Before the fix, leaving the create-node wizard's model dropdown at
"默认" caused `POST /api/anet/node-create` to omit `node_spec.model`
entirely; hub's `create_node.node_spec.model` schema is
`z.string().min(1).max(100)` and rejected the request with
`Invalid input: expected string, received undefined`. Real users who
didn't manually pick a model hit a hub 400 they couldn't decode from
the UI.

After the fix:

- `RUNTIMES` grows a `defaultModel` field per runtime; the wizard
  substitutes it into `node_spec.model` before submit.
- The dropdown's "默认" `<option>` label now reads
  **"默认（<runtime.defaultModel>）"** so the operator sees exactly
  which model that pick will send.
- The confirm step (⑤ 确认) echoes the same label.

## Screenshots

- `05-step3-model.png` — model dropdown reads
  `默认（claude-sonnet-4-6）`. The `<select>` value is still `""`,
  which is how the wizard tells the submit path to fall back.
- `07-step5-confirm.png` — confirm card shows
  `模型  默认（claude-sonnet-4-6）`.
- `10-online.png` — success panel: **✓ ga2-child-a 已上线 /
  节点已注册，已出现在节点列表**. Full end-to-end, no manual model
  pick required.

Playwright verdict line: `child registered visible in wizard: true`.

## Fixture

Reuses `docs/tests/p-ga2-compat-repro/` (in the `agent-network`
repo) — same aligned-version docker with hub + daemon, port 9234
forwarded. Dashboard prod build off this branch, cookie-inject
admin via `POST /api/auth/v3`, Playwright drives the wizard exactly
as before but leaves the model select untouched at "默认".
