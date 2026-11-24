# @zouhair_elmattad/healwright

Self-healing locators and resilient Playwright tests with a local reporting backend.

## Requirements

- Node.js 20+
- Playwright and `@playwright/test` 1.40+ (1.65.x verified locally)
- Java 21
- PostgreSQL for the backend

Docker is not required at runtime.

## Default profile

Healing is enabled with `scoreCap: 0.6`, one recovery attempt, measured `adaptive` scoring, a 2-second action timeout, reporting enabled, and automatic source rewriting. The backend launcher defaults to port `7878`, database and schema `healwright`, user `healwright_user`, metrics disabled, the project report directory, and the project rewrite allowlist. The verified Playwright profile keeps a 120-second total test timeout.

## Install

```bash
npm install @zouhair_elmattad/healwright
npm install -D playwright @playwright/test
npx playwright install chromium
```

## Start the backend

Download `healwright-backend-3.5.1.jar` from [GitHub Releases](https://github.com/zouhairElMa/Healwright/releases). From the Playwright project root, configure PostgreSQL and run:

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

java -jar /path/to/healwright-backend-3.5.1.jar
```

For a fresh installation, the npm launcher defaults to database and schema `healwright`, user `healwright_user`, port `7878`, metrics disabled, the project report directory, and the project rewrite allowlist. Only the password is required:

```bash
export SPRING_POSTGRES_PASSWORD='<your-password>'
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
```

Verify:

```bash
curl --fail http://localhost:7878/actuator/health
```

## Verified live Playwright test

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

Run:

```bash
npx playwright test
```

Keep the total test timeout longer than `actionTimeout`. Healing starts only after the original locator action fails; the remaining time covers backend lookup, replay, assertions, and teardown.

Expected evidence:

- The test passes.
- `.healwright/reports/<session-id>.jsonl` contains `replay.ok` events for `#lambdatest`.
- Safely healed measured callsites are rewritten to `#lambdatest` and journaled under `~/.healwright/rewrite/`.

To repeat the healing scenario, restore the previous source first:

```bash
npx healwright-rewrite revert --scope last
npx playwright test
```

Automatic rewriting is the default. It requires the backend allowlist, never writes report-only sessions, and can be disabled with `sourceRewrite: 'off'`.

## Programmatic API

```ts
import { chromium } from 'playwright';
import { heal } from '@zouhair_elmattad/healwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://example.com');

const healedPage = heal(page, { serverUrl: 'http://localhost:7878' });
await healedPage.locator('#submit').click();

await browser.close();
```

## CLI tools

```bash
npx healwright-doctor
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
npx healwright-report --backend http://localhost:7878 --port 7879
npx healwright-rewrite status
npx healwright-rewrite apply --dry-run
npx healwright-rewrite revert --scope last
```

## Documentation

- [Repository](https://github.com/zouhairElMa/Healwright#readme)
- [Getting started](https://github.com/zouhairElMa/Healwright/blob/main/docs/getting-started.md)
- [Configuration](https://github.com/zouhairElMa/Healwright/blob/main/docs/configuration.md)
- [Source rewriting](https://github.com/zouhairElMa/Healwright/blob/main/docs/rewriting.md)
- [Backend](https://github.com/zouhairElMa/Healwright/blob/main/docs/backend.md)
- [Known limitations](https://github.com/zouhairElMa/Healwright/blob/main/docs/limitations.md)
- [Security](https://github.com/zouhairElMa/Healwright/blob/main/docs/security.md)

## License

Apache-2.0. See `LICENSE` and `NOTICE` in this package.
