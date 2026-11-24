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

Existing databases can keep their current names by setting the environment variables explicitly. For the legacy local database, use `SPRING_POSTGRES_DB=healenium`, `SPRING_POSTGRES_SCHEMA=healenium`, and `SPRING_POSTGRES_USER=healenium_user`. Back up the database before a schema migration.

## Configuration names

Use `HEALWRIGHT_*` environment variables in new projects. Legacy aliases may remain for compatibility, but new documentation and examples should use Healwright names.

## Scoring

The default scoring profile is now `adaptive`, based on the measured benchmark results. Existing projects that need the previous behavior can explicitly select `healenium` or its equivalent `healwright` alias. Keep `scoreCap: 0.6` unless a separate benchmark justifies changing it.

## Source rewriting

Automatic rewriting is now the client default. It still requires `HEALWRIGHT_APPLY_ROOTS`; the standard backend launcher sets it to the current project directory. Review existing rewrite journals before enabling the allowlist in a migrated project. Start with `healwright-rewrite list` and `apply --dry-run`, or set `sourceRewrite: 'off'` while reviewing.
