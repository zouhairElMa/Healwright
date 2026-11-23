---
layout: default
title: Healwright
---

# Healwright

Healwright helps Playwright tests react to DOM changes when a locator fails. The healing engine runs inside the Playwright process, while a local Java backend stores references and serves the reporting dashboard.

## Start here

1. [Install Healwright](getting-started.md).
2. [Start the backend](backend.md).
3. [Wrap a page or use the fixture](api.md).
4. [Review configuration](configuration.md).
5. [Inspect reports](reporting.md).

## Safety model

- A failed action is replayed at most once by default.
- `reportOnly` records proposals without applying them.
- Source rewriting is explicit, allowlisted, journaled, and reversible.
- The backend is intended for a trusted local network.

## License

Healwright is available under Apache-2.0. Upstream attributions are preserved in the repository `NOTICE` file.
