# OSS security gates

The repository runs value-safe checks for credentials, non-portable source paths, binary byte strings, package contents, dependencies, lint, and production builds.

## History attestation

`npm run oss:secrets:history` requires a full clone with every retained branch fetched. A shallow clone fails closed instead of claiming that incomplete history is clean. Findings report only commit and path; matched values are suppressed.

## Public surfaces

`npm run oss:surface` scans tracked files plus GitHub repository metadata, issue and pull-request bodies, comments, release metadata and asset names, and branch/tag names. Every GitHub surface prints a scanned denominator.

Surfaces the command cannot attest are printed as `NOT COVERED`. These currently include release asset contents, Actions logs and artifact contents, Wiki pages, Pages, and Discussions. A zero finding count must never be interpreted as coverage of those surfaces.

Linux and macOS user-home paths are rejected generically. Deployment operators may set the comma-separated `OSS_PRIVATE_HOST_SUFFIXES` repository variable to scan organization-specific private hostnames without committing those values to source. When it is absent, the scanner explicitly reports `private_host_suffixes: NOT CONFIGURED`.

`npm run oss:binaries` scans tracked binary files for extractable credential, user-home, and configured private-host byte sequences. It reports paths only. Visual content and compressed semantics are explicitly `NOT COVERED`; release screenshots and personalized runtime imagery require separate human review and are not kept as repository test evidence.

## Local verification

### Reviewed root-script inventory

`scripts/oss-readiness-check.mjs` keeps an exact-path allowlist of reviewed files
under `scripts/`. New files require a review and an explicit entry; browser
probes are not executed by this inventory check. The Legion tooling added to
that inventory was reviewed with these inputs and side effects:

| File under `scripts/` | Purpose and inputs | Side effects |
|---|---|---|
| `accent-text-baseline.json` | Per-source-file counts used by the accent-text ratchet | Data only; no execution |
| `check-accent-text-ratchet.mjs` | Reads `app/` and the accent-text baseline | `--update` rewrites that baseline; normal checks only read |
| `check-no-build-artifacts.mjs` | Reads the Git index with `git ls-files` to reject tracked build output | No file writes or network requests |
| `check-token-contrast.mjs` | Reads theme values in `app/globals.css` and computes contrast | No file writes or network requests |
| `bench-legion.mjs` | Playwright frame-timing probe using `BASE_URL`, `SAMPLE_MS` and optional `STORAGE_STATE` | Loads the supplied browser session file, or posts the login password; navigates and manipulates the 3D view |
| `check-canvas-labels.mjs` | Playwright pixel/contrast probe using `BASE_URL` | Posts the login password and renders a temporary Canvas in the page |
| `check-contrast.mjs` | Playwright DOM contrast probe using `BASE_URL`, `THEMES` and `PAGES` | Posts the login password and visits configured pages |
| `smoke-legion.mjs` | Playwright 2D/3D interactions using `BASE_URL` | Posts the login password, reads directory data, exercises browser clipboard, and saves PNG exports/screenshots under `TMPDIR` (system temporary directory by default) |
| `smoke-legion-discs.mjs` | Opt-in synthetic 3D geometry/interaction probe using `BASE_URL`, required `OUTPUT_DIR`, and optional `FIXTURE_PASSWORD` (test-only default); requires clean tracked Git status, including staged changes, and matching source/build SHA | GETs loopback `/api/health`; accepts only `127.0.0.1` and rejects ports 3101/3102. Sets a local browser cookie from the fixture password, intercepts all browser API/portrait requests with fixtures, blocks external origins, and interacts with the local 3D/organization views. Writes PNG screenshots, JSON results, and an exact probe copy to `OUTPUT_DIR`; does not post credentials or write to Hub |
| `smoke-legion-interactions.mjs` | Synthetic Agent-directory, platform-detail, fullscreen and inline-chat acceptance; same clean-source/build identity gate and environment inputs as the disc probe | Loopback health GET only before Chromium; all browser APIs including chat POSTs are fulfilled by synthetic fixtures, external origins blocked. Saves screenshots, probe copy and JSON to `OUTPUT_DIR`; no real Hub reads or writes |
| `smoke-schedule-history.mjs` | Synthetic schedule-history request ordering, network isolation and loading/error/retry checks; requires `BASE_URL`, `OUTPUT_DIR`, clean tracked source and matching build SHA | Loopback health GET only before Chromium; browser APIs are synthetic, external origins blocked, only GET requests accepted. Holds and releases responses to verify races; writes screenshots, exact probe and JSON locally. No schedules execute |
| `smoke-tasks-scope.mjs` | Delayed task-list success, auth/error, JSON and filter-clear regression probe; requires `BASE_URL`, `OUTPUT_DIR`, clean tracked source and matching build SHA | Loopback health GET; rejects production/real-preview ports 3001/3101/3102. Uses fixture-only browser authentication and synthetic API responses, blocks external origins. Writes screenshots, exact probe and result JSON to `OUTPUT_DIR`; no real Hub reads, sends or writes |
| `smoke-routes.mjs` | Playwright route checks using `BASE_URL`, `THEMES`, `ONLY` and `IGNORE_5XX` | Posts the login password and visits routes; configured response exclusions are part of its coverage |
| `verify-prod.mjs` | HTTP health/page/asset checks using `--base`, optional `--expect` and `--browser`; reads local package/build identity | GET requests and optional unauthenticated browser navigation; no login or configuration writes |

The authenticated probes read `ANET_DASHBOARD_PASSWORD` and retain the existing
development fallback when it is absent. Their `BASE_URL` defaults to localhost,
but accepts a caller-selected host; unlike `smoke-legion-labels.mjs` and
`smoke-legion-discs.mjs`, they do not
enforce a loopback-only target or synthetic data. Registration documents the
scripts' behavior; it is not evidence that they ran or that a real-account or
production acceptance check passed.

### Commands

```bash
npm ci
npm run oss:check
npm run oss:binaries
npm run oss:secrets:history
npm run oss:surface
npm run lint
npm run build
```

Never paste a matched credential into an issue, pull request, test report, or CI log. Revoke it first, then sanitize every retained ref and independently verify a fresh full clone.
