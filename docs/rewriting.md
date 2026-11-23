---
layout: default
title: Source rewriting
---

# Source rewriting

Healwright can write healed locators back into Playwright source files. Rewriting is explicit, restricted to an allowlist, journaled, and reversible.

## Enable the backend allowlist

Set `HEALWRIGHT_APPLY_ROOTS` to the absolute Playwright project root before starting the backend:

```bash
export HEALWRIGHT_APPLY_ROOTS="$PWD"
java -jar healwright-backend-3.5.1.jar
```

Multiple roots can be separated using the platform path separator. Keep the allowlist as narrow as possible.

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

## Automatic mode

`sourceRewrite: 'auto'` submits the session for rewriting when the report closes. It still requires the backend allowlist and uses the same journal and revert engine.

Automatic mode is disabled by default.
