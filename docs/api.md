---
layout: default
title: API
---

# API

## `heal(page, options)`

Wraps a Playwright `Page` and returns a compatible page object with healing enabled.

```ts
import { heal } from '@zouhair_elmattad/healwright';

const healedPage = heal(page, {
  serverUrl: 'http://localhost:7878',
  reportOnly: false,
  testName: 'checkout',
  testFile: 'tests/checkout.spec.ts',
});
```

Important options:

| Option | Purpose |
|---|---|
| `serverUrl` | Backend base URL. |
| `healEnabled` | Enable or disable healing. |
| `scoreCap` | Maximum accepted candidate score. |
| `recoveryTries` | Number of replay attempts. Default: `1`. |
| `reportOnly` | Record proposals without applying them. |
| `reportDir` | Local JSONL telemetry directory. |
| `disableHealingFor` | Exact selector strings excluded from healing. |
| `sourceRewrite` | `off` by default; `auto` enables session-end rewriting. |
| `scoring` | Legacy, improved, or adaptive profile. |

## Playwright fixture

```ts
import { test, expect } from '@zouhair_elmattad/healwright/test';

test.use({ healOptions: { serverUrl: 'http://localhost:7878' } });

test('uses a healed page', async ({ healedPage }) => {
  await healedPage.locator('#submit').click();
  await expect(healedPage.locator('#submit')).toBeVisible();
});
```

The fixture creates a `healedPage` based on the built-in `page` fixture and closes the Healwright session after the test.

## Configuration helpers

```ts
import { DEFAULT_CONFIG, resolveConfig } from '@zouhair_elmattad/healwright';

const config = resolveConfig({ scoreCap: 0.6, reportOnly: true });
console.log(DEFAULT_CONFIG.serverUrl, config.reportOnly);
```

Configuration precedence is user option, then environment variable, then default.

## Session handle

`healwrightSession` is exported for advanced integrations that need explicit session lifecycle access. Most users should use `heal()` or the Playwright fixture.

## Exported types

The package exports configuration, scoring, backend DTO, healing-engine, reporter, adapter, and selector types. See `client/src/index.ts` for the complete export surface.
