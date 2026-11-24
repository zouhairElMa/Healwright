---
layout: default
title: Getting started
---

# Getting started

This guide runs the complete stack locally and executes a real browser scenario that changes a locator. No Docker is required.

## 1. Install the client

Requirements: Node.js 20+, Playwright 1.40+, Java 21, and PostgreSQL. Playwright 1.65.x was verified locally.

This guide uses the recommended default profile: healing enabled, `scoreCap: 0.6`, one recovery attempt, measured `adaptive` scoring, a 2-second action timeout, reporting enabled, automatic source rewriting, backend port `7878`, and a 120-second total test timeout. See [Configuration](configuration.md#recommended-default-profile) for every default and override.

```bash
npm install @zouhair_elmattad/healwright
npm install -D playwright @playwright/test
npx playwright install chromium
```

## 2. Create PostgreSQL credentials

For a fresh installation:

```bash
createuser --pwprompt healwright_user
createdb -O healwright_user healwright
psql -h localhost -U healwright_user -d healwright \
  -c "CREATE SCHEMA IF NOT EXISTS healwright AUTHORIZATION healwright_user;"
```

If the legacy database already exists, do not recreate it. Use its existing identifiers in the next step: `SPRING_POSTGRES_DB=healenium`, `SPRING_POSTGRES_SCHEMA=healenium`, and `SPRING_POSTGRES_USER=healenium_user`.

## 3. Start the backend

Download `healwright-backend-3.5.1.jar` from [GitHub Releases](https://github.com/zouhairElMa/Healwright/releases). From the Playwright project root, run:

```bash
export SPRING_SERVER_PORT=7878
export SPRING_POSTGRES_DB_HOST=localhost
export SPRING_POSTGRES_DB_PORT=5432
export SPRING_POSTGRES_DB=healwright
export SPRING_POSTGRES_SCHEMA=healwright
export SPRING_POSTGRES_USER=healwright_user
export SPRING_POSTGRES_PASSWORD='<your-password>'
export HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"
export HEALWRIGHT_APPLY_ROOTS="$PWD"
export COLLECT_METRICS=false

java -jar /path/to/healwright-backend-3.5.1.jar
```

For a fresh installation, the npm launcher defaults to database and schema `healwright`, user `healwright_user`, port `7878`, metrics disabled, `HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"`, and `HEALWRIGHT_APPLY_ROOTS="$PWD"`. Only the password is required:

```bash
export SPRING_POSTGRES_PASSWORD='<your-password>'
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
```

Verify the service:

```bash
curl --fail http://localhost:7878/actuator/health
curl --fail http://localhost:7878/api/config
```

Open <http://localhost:7878/>. If `java` is not Java 21, follow the [Java 21 instructions](backend.md#java-21-on-macos-with-homebrew).

## 4. Add the verified live test

Create `tests/example.spec.ts`:

```ts
import { test, expect } from '@zouhair_elmattad/healwright/test';

const CHANGE_BTN = 'p.selenium_btn';

test.setTimeout(120_000);

test.use({
  healOptions: {
    serverUrl: 'http://localhost:7878',
    actionTimeout: 2_000,
    className: 'LiveTestmuai',
    methodName: 'autoHealing',
    reporting: true,
    reportDir: '.healwright/reports',
  },
});

test('testmuai: heals #username -> #lambdatest and replays fill', async ({ healedPage }) => {
  await healedPage.goto('https://www.testmuai.com/selenium-playground/auto-healing/');

  await healedPage.locator('#username').fill('testuser');

  await healedPage.locator(CHANGE_BTN).click({ delay: 500 });
  await healedPage.waitForTimeout(1_000);
  await healedPage.locator(CHANGE_BTN).click({ delay: 500 });
  await healedPage.waitForTimeout(1_000);

  await healedPage.locator('#username').fill('testuser1');
  await expect(healedPage.locator('#username')).toHaveValue('testuser1');

  await healedPage.locator('#username').fill('testuser2');
  await expect(healedPage.locator('#username')).toHaveValue('testuser2');
});
```

Run it:

```bash
npx playwright test
```

The 120-second total test timeout must exceed the 2-second action timeout. Healing begins only after the original locator action fails; the remaining time covers backend lookup, replay, assertions, and teardown. For a slower application, increase `healOptions.actionTimeout` and the total test timeout rather than changing the scoring defaults.

Packaged `0.2.1` verification evidence using the default `adaptive` profile and 2,000 ms action timeout is available in [live-testmuai-0.2.1-defaults.json](evidence/live-testmuai-0.2.1-defaults.json) and [live-testmuai-0.2.1-defaults.jsonl](evidence/live-testmuai-0.2.1-defaults.jsonl).

### Recommended fixture for an existing suite

For a custom Playwright project, create `tests/fixtures.ts` with the following fixture and import `test` and `expect` from it in every spec. Use `healedPage` for every action under test. The explicit options document the measured production profile; environment overrides are intended for controlled comparisons.

```ts
import { test as base, expect, type Page } from '@playwright/test';
import { heal } from '@zouhair_elmattad/healwright';

type Fixtures = {
  /** Page wrapped by Healwright: use it for every action under test. */
  healedPage: Page;
};

export const test = base.extend<Fixtures>({
  healedPage: async ({ page }, use, testInfo) => {
    const healedPage = heal(page, {
      testName: testInfo.title,
      testFile: testInfo.file,
      serverUrl: process.env.HEALWRIGHT_SERVER_URL ?? 'http://localhost:7878',
      healEnabled: true,
      scoreCap: 0.6,
      // Final package benchmark: adaptive 119/128, with 9 disclosed failures/refusals.
      // Use HEALWRIGHT_SCORING only for controlled comparisons.
      scoring:
        (process.env.HEALWRIGHT_SCORING as
          | 'healenium'
          | 'improved'
          | 'adaptive'
          | undefined) ?? 'adaptive',
      reportOnly: false,
      sourceRewrite: 'auto',
      localXPathFallback: true,
      frameHealing: true,
      shadowHealing: true,
      assertionHealing: true,
      imitatorMode: 'in-process',
      improvements: {
        emptyNeutrality: true,
        positionTiebreak: true,
        distinctiveSignals: true,
        minimumEvidence: true,
        ambiguityGuard: true,
        ambiguityMargin: 0.02,
        evidenceSimilarity: 0.45,
        indexWeight: 20,
        genericAttributeRatio: 0.5,
      },
      reporting: true,
      reportDir: process.env.HEALWRIGHT_REPORT_DIR ?? '.healwright/reports',
      actionTimeout: 2_000,
    });
    await use(healedPage);
  },
});

export { expect };
```

Keep `test.setTimeout(120_000)` in each spec so the total test timeout remains longer than the 2-second action timeout. In adaptive mode, `genericAttributeRatio` still applies; the other improvement switches matter only when selecting `improved`. Automatic rewriting modifies measured source callsites inside the backend allowlist. Use `reportOnly: true` for a read-only audit or `sourceRewrite: 'off'` to keep healing without source edits.

## 5. Inspect the result

The run should pass and create `.healwright/reports/<session-id>.jsonl`. Look for `replay.ok` events whose healed locator is `#lambdatest`.

Automatic source rewriting is the default. After the session closes, safely healed measured callsites are rewritten inside `HEALWRIGHT_APPLY_ROOTS`, and the original expression is kept in a `// healwright:` comment. The journal is stored under `~/.healwright/rewrite/`.

To repeat the healing scenario, revert the last rewrite before running the test again:

```bash
npx healwright-rewrite revert --scope last
npx playwright test
```

To audit without replaying or rewriting:

```ts
test.use({ healOptions: { reportOnly: true } });
```

## 6. Diagnose the stack

```bash
npx healwright-doctor
```

The doctor checks Node.js, Java, PostgreSQL connectivity, backend health, and dashboard availability.

## Next steps

- [API reference](api.md)
- [Configuration](configuration.md)
- [Reporting](reporting.md)
- [Source rewriting](rewriting.md)
- [Backend setup](backend.md)
- [Known limitations](limitations.md)
