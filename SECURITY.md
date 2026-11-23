# Security policy

## Supported versions

Security fixes are applied to the latest stable release. Older versions are not actively maintained unless a fix is backported explicitly.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/zouhairElMa/Healwright/security/advisories/new).

Include the affected version, reproduction steps, impact, and any proposed mitigation. Do not include passwords, tokens, personal data, or private customer code.

## Deployment requirements

- Set `SPRING_POSTGRES_PASSWORD`; no default is provided.
- Rotate credentials that used an older default.
- Keep PostgreSQL on a trusted network.
- Do not expose the backend dashboard or API directly to the Internet.
- Use an authenticated TLS reverse proxy for remote access.
- Restrict `HEALWRIGHT_APPLY_ROOTS` to directories where source rewriting is intended.
- Never commit `.env` files, npm tokens, GitHub tokens, or database credentials.

## Response process

The maintainer will acknowledge the report, assess the impact, prepare a fix, and publish a security note when appropriate. No response-time guarantee is currently defined.
