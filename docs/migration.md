---
layout: default
title: Migration
---

# Migration

## From a local release-candidate tarball

Replace local tarball installation with the scoped package:

```bash
npm uninstall healwright
npm install @zouhair_elmattad/healwright
```

Update imports:

```ts
import { heal } from '@zouhair_elmattad/healwright';
import { test, expect } from '@zouhair_elmattad/healwright/test';
```

Remove any local `.tgz` path from `package.json` and regenerate the lockfile with `npm install`.

## Backend configuration

For a new installation, use Healwright database defaults:

```bash
export SPRING_POSTGRES_DB=healwright
export SPRING_POSTGRES_SCHEMA=healwright
export SPRING_POSTGRES_USER=healwright_user
export SPRING_POSTGRES_PASSWORD='<your-password>'
```

Existing databases can keep their current names by setting the environment variables explicitly. Back up the database before a schema migration.

## Configuration names

Use `HEALWRIGHT_*` environment variables in new projects. Legacy aliases may remain for compatibility, but new documentation and examples should use Healwright names.

## Scoring

The default scoring profile remains `healenium` for compatibility. Do not change it during a migration unless you intentionally evaluate `improved` or `adaptive` mode with a frozen benchmark.

## Source rewriting

Review existing rewrite journals before enabling `HEALWRIGHT_APPLY_ROOTS` in a new project. Start with `healwright-rewrite list` and `apply --dry-run`.
