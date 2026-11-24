# Changelog

## 0.2.1 - 2026-11-24

- Made safe source rewriting automatic by default while preserving the backend directory allowlist and reversible journals.
- Prevented automatic rewriting in `reportOnly` sessions.
- Made the npm backend launcher set `HEALWRIGHT_APPLY_ROOTS` to the current project directory and default to the Healwright database, schema, user, port, and disabled metrics.
- Made the programmatic `actionTimeout` option apply Playwright's default action timeout.
- Made `scoring: 'adaptive'` and `actionTimeout: 2_000` the production defaults while keeping `scoreCap: 0.6` and the F1-F5/F4b parameters unchanged.
- Replaced the generic quick start with the verified TestMu AI healing scenario, exact timeouts, reporting settings, Java 21/PostgreSQL setup, and a complete default-profile reference.
- Recorded final-package verification with the new defaults and disclosed the 128-case benchmark result (119 passed, 9 failed), including the reproducible IF-04 nested-frame regression.
- Added a copy-ready custom Playwright fixture using `healedPage`, adaptive scoring, the 2-second action timeout, reporting, and automatic source rewriting.

## 0.2.0 - prepared for publication

- Added the `@zouhair_elmattad/healwright` npm package identity.
- Added a self-contained backend jar with the embedded dashboard.
- Added PostgreSQL password enforcement without a default fallback.
- Added Playwright fixture and programmatic APIs.
- Added CSS, XPath, iframe, open shadow-root, and assertion healing.
- Added `reportOnly` audit mode.
- Added local JSONL telemetry and dashboard reporting.
- Added explicit source rewriting with journals and revert support.
- Added the `healwright` scoring alias and legacy, improved, and adaptive scoring profiles.
- Added GitHub Actions workflows for client, browser, and backend validation.
- Added English public documentation and governance files.
- Preserved Apache-2.0 licensing and upstream attributions.

## Compatibility notes

- Node.js 20+.
- Playwright 1.40+; verified locally with 1.65.x.
- Java 21.
- PostgreSQL 13.0 verified locally; other versions are not yet verified.
- The default scoring profile is `adaptive`; `healenium` and `healwright` remain selectable legacy profiles.
- The backend dashboard and API require a trusted network or an authenticated TLS reverse proxy.
