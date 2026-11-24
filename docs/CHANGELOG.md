---
layout: default
title: Changelog
---

# Changelog

## 0.2.2 - 2026-11-24

- Refined the documentation home with the Healwright logo and wordmark, corrected before/after visual, expanded client-consulting story, industrial workflow, and reporting example.
- Corrected the before/after visual to use the native Playwright logo and the native Healwright mark without its wordmark.
- Added Java 21 and PostgreSQL dependency badges, LinkedIn, and an Apache-2.0 and trademark presentation.
- Added the [project story](story.md) and [acceptance-testing methodology](acceptance-testing.md), with historical campaign aggregates kept separate from final benchmark and live-verification evidence.
- Added reporting captions that distinguish illustrative dashboard data from release benchmark evidence.
- Kept runtime behavior and the verified 0.2.1 production defaults unchanged.

## 0.2.1 - 2026-11-24

- Made safe source rewriting automatic by default while preserving the backend directory allowlist and reversible journals.
- Prevented automatic rewriting in `reportOnly` sessions.
- Made the npm backend launcher set `HEALWRIGHT_APPLY_ROOTS` to the current project directory and default to the Healwright database, schema, user, port, and disabled metrics.
- Made the programmatic `actionTimeout` option apply Playwright's default action timeout.
- Made `scoring: 'adaptive'` and `actionTimeout: 2_000` the production defaults while keeping `scoreCap: 0.6` and the F1-F5/F4b parameters unchanged.
- Added the verified TestMu AI scenario with exact timeout, reporting, Java 21, PostgreSQL parameters, and a complete default-profile reference.
- Recorded final-package verification with the new defaults and disclosed the 128-case benchmark result (119 passed, 9 failed), including the reproducible IF-04 nested-frame regression.
- Added a copy-ready custom Playwright fixture using `healedPage`, adaptive scoring, the 2-second action timeout, reporting, and automatic source rewriting.

## 0.2.0 - prepared for publication

- Scoped npm package: `@zouhair_elmattad/healwright`.
- Self-contained backend jar with embedded dashboard.
- Mandatory PostgreSQL password without a fallback.
- Programmatic API and Playwright fixture.
- CSS, XPath, iframe, open shadow-root, and assertion healing.
- `reportOnly` audit mode.
- JSONL telemetry and dashboard reporting.
- Explicit journaled source rewriting.
- Legacy, improved, and adaptive scoring profiles, plus the equivalent `healwright` alias.
- Client, browser, and backend CI workflows.
- English documentation and governance files.

See the repository [changelog](../CHANGELOG.md) for compatibility notes.
