---
layout: default
title: Known limitations
---

# Known limitations

Healwright does not claim complete Playwright or browser parity. The following limitations are known:

- Closed shadow roots and slots are not healed.
- Combined iframe and shadow-DOM scenarios are not fully supported.
- Chained `getBy*` locators on a `Locator` are not fully supported.
- Negated assertions and found-but-not-matching assertion failures are not healed.
- Assertion healing uses Playwright’s internal `locator._expect` protocol. A major Playwright update can break this integration.
- An element that exists but is not actionable is not healed.
- The backend dashboard and API do not provide application authentication.
- PostgreSQL compatibility has been verified locally only with PostgreSQL 13.0.
- Source rewriting is restricted to configured roots and can report conflicts instead of overwriting them.
- The legacy scoring profile remains the default for compatibility; improved and adaptive profiles are opt-in.

Use `reportOnly` to evaluate proposals before enabling healing in a real suite. Always keep a clean source-control checkpoint before applying rewrites.
