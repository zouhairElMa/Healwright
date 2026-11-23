---
layout: default
title: Reporting
---

# Reporting

## Embedded dashboard

The backend jar serves the dashboard at <http://localhost:7878/>. It displays sessions, test files, locators, candidates, scores, screenshots, timings, and replay outcomes.

The dashboard reads:

- `HEALWRIGHT_REPORT_DIR`.
- Absolute directories registered by the client in `~/.healwright/dirs.json`.
- An optional registry override, `HEALWRIGHT_REPORT_REGISTRY`.

For separate machines or containers, configure the same shared report directory on both sides.

## Local telemetry

Each session writes JSONL events under:

```text
<reportDir>/<sessionId>.jsonl
```

The first metadata event records the Playwright test name and file. Later events record references, candidates, scores, timings, and replay outcomes.

## Standalone dashboard

A dependency-free Node dashboard can proxy a remote backend:

```bash
npx healwright-report \
  --backend http://backend-host:7878 \
  --port 7879 \
  --report-dir "$PWD/.healwright/reports"
```

## Audit mode

Enable `reportOnly` to calculate and log proposals without replaying the action:

```ts
const healedPage = heal(page, { reportOnly: true });
```

The original action still fails when its locator is broken. This mode is intended for evaluating a real suite before enabling healing.

## Data retention

Healwright does not automatically delete telemetry files. Cleanup must be explicit and should follow your organization’s data-retention policy.
