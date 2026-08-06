# OSS security gates

The repository runs value-safe checks for credentials, non-portable source paths, package contents, dependencies, lint, and production builds.

## History attestation

`npm run oss:secrets:history` requires a full clone with every retained branch fetched. A shallow clone fails closed instead of claiming that incomplete history is clean. Findings report only commit and path; matched values are suppressed.

## Public surfaces

`npm run oss:surface` scans tracked files plus GitHub repository metadata, issue and pull-request bodies, comments, release metadata and asset names, and branch/tag names. Every GitHub surface prints a scanned denominator.

Surfaces the command cannot attest are printed as `NOT COVERED`. These currently include release asset contents, Actions logs and artifact contents, Wiki pages, Pages, and Discussions. A zero finding count must never be interpreted as coverage of those surfaces.

Linux and macOS user-home paths are rejected generically. Deployment operators may set the comma-separated `OSS_PRIVATE_HOST_SUFFIXES` repository variable to scan organization-specific private hostnames without committing those values to source. When it is absent, the scanner explicitly reports `private_host_suffixes: NOT CONFIGURED`.

## Local verification

```bash
npm ci
npm run oss:check
npm run oss:secrets:history
npm run oss:surface
npm run lint
npm run build
```

Never paste a matched credential into an issue, pull request, test report, or CI log. Revoke it first, then sanitize every retained ref and independently verify a fresh full clone.
