---
layout: default
title: Security
---

# Security

## Required controls

- `SPRING_POSTGRES_PASSWORD` is mandatory and has no default.
- Rotate any credential that used an older default.
- Keep PostgreSQL and the backend on a trusted network.
- Do not expose the dashboard or API directly to the Internet.
- Use an authenticated TLS reverse proxy for remote access.
- Restrict `HEALWRIGHT_APPLY_ROOTS` to intended source directories.
- Never commit `.env` files, passwords, npm tokens, or GitHub tokens.
- Review telemetry and screenshots for personal or customer data before sharing them.

## Reporting

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/zouhairElMa/Healwright/security/advisories/new).

Do not include secrets or private customer code in a report. See the repository [security policy](../SECURITY.md).

## Runtime evidence

When validating a security-sensitive change, record the command, environment, result, and artifact hash. A screenshot alone does not prove registry metadata or configuration contents.
