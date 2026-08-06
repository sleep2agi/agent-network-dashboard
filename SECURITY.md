# Security Policy

## Report a vulnerability

Do not open a public issue for vulnerabilities, leaked credentials, or private deployment data. Use [GitHub Private Security Advisories](https://github.com/sleep2agi/agent-network-dashboard/security/advisories/new).

Include the affected version or commit, impact, reproduction steps, and a suggested remediation when available. Redact credentials and personal data from screenshots and logs.

We aim to acknowledge reports within 48 hours and prioritize fixes by impact. Coordinated disclosure and reporter credit are available on request.

## Supported versions

Only the latest published Dashboard release and the current `main` branch receive security fixes.

## Deployment boundary

Agent Network Dashboard is an administrative interface. A safe internet-facing deployment requires all of the following:

- explicit authentication and non-default credentials;
- TLS at the edge;
- a trusted reverse proxy or equivalent access control;
- a CommHub version with server-side authorization enabled;
- no secrets embedded in images, source files, browser bundles, or logs.

The presence of a Dashboard session cookie is not itself authorization. API routes must validate the session or delegate authorization to CommHub.

## Dependency reports

If a vulnerable dependency affects this project, report it here as well as upstream. Include the dependency name, advisory, reachable code path, and available fixed version.
