# Dashboard design-language mapping

The canonical specification and tokens live in [sleep2agi/anet-design](https://github.com/sleep2agi/anet-design), with the [client implementation](https://github.com/sleep2agi/agent-network-app/blob/main/src/theme.ts) as the original source. This file records Dashboard adoption, not a second design system.

## Dark-theme adoption

The deployed-renderer candidate adopts the existing palette from [Dashboard #62](https://github.com/sleep2agi/agent-network-dashboard/pull/62). Its CSS variables remain stable for consumers in 2D, 3D, platform view and other Dashboard pages.

| Dashboard variable | Canonical semantic | Value |
| --- | --- | --- |
| `--bg` | `bg` | `#111113` |
| `--bg-secondary` | `card` | `#18181b` |
| `--bg-elevated` | `rowActive` | `#222227` |
| `--fg` | `text` | `#ededef` |
| `--fg-muted` | `textSecondary` | `#a1a1aa` |
| `--fg-dim` | `textMuted` | `#8b8b95` |
| `--border` | `border` | `#242428` |
| `--accent`, `--accent-text` | dark `accent` | `#5e9bff` |
| `--accent-fg` | dark `onAccent` | `#0b0b0d` |
| `--success` | `running` | `#22c55e` |

Solid accent fills must use `--accent-fg` for text and glyphs. Translucent selected surfaces use `--accent-text`. The light-blue fill and near-black foreground must migrate together, including hover states. Disabled buttons retain their neutral surface/text pair.

The deployed branch's readable `--danger` and `--info` values remain in place. Its light theme and legacy hard-coded colors are later migration work; this adoption does not claim complete cross-product parity. The 3D core follows the active theme, while the C-direction logo itself remains subject to brand review.

## Changes and verification

New canonical values require review in anet-design first. Dashboard adoption changes update README, this mapping and CHANGELOG together. Run `npm run gates`, inspect computed styles in the browser, and review dark/light screenshots and solid-button foreground contrast before integration. Public release still requires the repository's release checks and human confirmation.
