# Changelog

## 0.2.0 - prepared for publication

- Added the `@zouhair/healwright` npm package identity.
- Added a self-contained backend jar with the embedded dashboard.
- Added PostgreSQL password enforcement without a default fallback.
- Added Playwright fixture and programmatic APIs.
- Added CSS, XPath, iframe, open shadow-root, and assertion healing.
- Added `reportOnly` audit mode.
- Added local JSONL telemetry and dashboard reporting.
- Added explicit source rewriting with journals and revert support.
- Added the `healwright` scoring alias while preserving the frozen `healenium` default.
- Added legacy, improved, and adaptive scoring profiles.
- Added GitHub Actions workflows for client, browser, and backend validation.
- Added English public documentation and governance files.
- Preserved Apache-2.0 licensing and upstream attributions.

## Compatibility notes

- Node.js 20+.
- Playwright 1.40+; verified locally with 1.65.x.
- Java 21.
- PostgreSQL 13.0 verified locally; other versions are not yet verified.
- The default scoring profile remains the legacy `healenium` profile for compatibility.
- The backend dashboard and API require a trusted network or an authenticated TLS reverse proxy.
