---
layout: default
title: Source rewriting
---

# Source rewriting

Healwright can write healed locators back into Playwright source files. Automatic rewriting is enabled by default, but the backend still requires an explicit directory allowlist. Every write is measured, journaled, atomic, and reversible.

## Safety model

Automatic rewriting writes only when all of these conditions are true:

- The client session has `sourceRewrite: 'auto'` (the default).
- The session is not `reportOnly`.
- Reporting is enabled so the backend has the measured JSONL session.
- The source file is inside `HEALWRIGHT_APPLY_ROOTS`.
- The locator was actually healed and has a measured source callsite.
- The callsite uses a string literal.
- The healed target is unambiguous.

Variables, unmeasured occurrences, ambiguous targets, missing callsites, files outside the allowlist, and report-only sessions are never rewritten automatically. Manual dashboard and CLI actions remain available when an explicit choice is appropriate.

## Enable the backend allowlist

Set `HEALWRIGHT_APPLY_ROOTS` to the absolute Playwright project root before starting the backend:

```bash
cd /path/to/your/playwright-project
export HEALWRIGHT_APPLY_ROOTS="$PWD"
java -jar /path/to/healwright-backend-3.5.1.jar
```

The standard npm launcher sets this allowlist to the current directory automatically:

```bash
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
```

Multiple roots can be separated using the platform path separator (`:` on macOS and Linux, `;` on Windows). Keep the allowlist as narrow as possible.

If the backend was started without the allowlist, the dashboard reports that writing is disabled. Healing and replay still work; only source writing is refused.

## Automatic mode

No client option is required for automatic rewriting in current versions. The equivalent explicit configuration is:

```ts
test.use({
  healOptions: {
    sourceRewrite: 'auto',
    reporting: true,
    reportDir: '.healwright/reports',
  },
});
```

When the report closes, the fixture submits that session to the backend. The backend rewrites each safe measured callsite once and records a transaction under `~/.healwright/rewrite/`.

The original expression is preserved in a comment:

```ts
// healwright: #username
await healedPage.locator('#lambdatest').fill('testuser1');
```

Automatic rewriting never turns a passing test into a failing test. A backend refusal is recorded in the JSONL telemetry as `rewrite.failed`.

## Disable automatic rewriting

Use the client option:

```ts
test.use({ healOptions: { sourceRewrite: 'off' } });
```

Or use the environment variable:

```bash
export HEALWRIGHT_SOURCE_REWRITE=off
```

Report-only mode also suppresses rewriting, even if `sourceRewrite` is `auto`:

```ts
test.use({ healOptions: { reportOnly: true } });
```

## Inspect the plan

```bash
npx healwright-rewrite status
npx healwright-rewrite list
npx healwright-rewrite list --session <session-id>
npx healwright-rewrite list --file tests/checkout.spec.ts --json
```

## Dry run

```bash
npx healwright-rewrite apply --dry-run
```

Nothing is written in dry-run mode.

## Apply selected changes

```bash
npx healwright-rewrite apply --id <rewrite-id>
npx healwright-rewrite apply --all
npx healwright-rewrite apply --all --manual
```

`--manual` includes attempts whose locator argument is not a string literal. Review those changes carefully.

## Revert

```bash
npx healwright-rewrite revert --scope last
npx healwright-rewrite revert --scope session --session <session-id>
npx healwright-rewrite revert --scope transaction --transaction <transaction-id>
npx healwright-rewrite revert --scope all
```

A revert restores the recorded source bytes. Conflicts are reported and are not overwritten silently.

## Repeat the TestMu AI healing scenario

The verified example in the [getting-started guide](getting-started.md#4-add-the-verified-live-test) starts with `#username`. After the first successful run, automatic rewriting changes the measured callsites to `#lambdatest`. Restore the previous source before running the healing scenario again:

```bash
npx healwright-rewrite revert --scope last
npx playwright test
```
