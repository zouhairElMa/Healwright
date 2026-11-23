# @zouhair_elmattad/healwright

Self-healing locators and resilient Playwright tests with a local reporting backend.

## Install

```bash
npm install @zouhair_elmattad/healwright
npm install -D playwright @playwright/test
npx playwright install chromium
```

Requirements: Node.js 20+, Playwright 1.40+, Java 21, and PostgreSQL for the backend.

## Usage

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

Playwright fixture:

```ts
import { test, expect } from '@zouhair_elmattad/healwright/test';

test.use({ healOptions: { serverUrl: 'http://localhost:7878' } });

test('healed page', async ({ healedPage }) => {
  await healedPage.locator('#submit').click();
  await expect(healedPage.locator('#submit')).toBeVisible();
});
```

## CLI tools

```bash
npx healwright-doctor
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
npx healwright-report --backend http://localhost:7878 --port 7879
npx healwright-rewrite --help
```

## Documentation

- [Repository](https://github.com/zouhairElMa/Healwright#readme)
- [Getting started](https://github.com/zouhairElMa/Healwright/blob/main/docs/getting-started.md)
- [Configuration](https://github.com/zouhairElMa/Healwright/blob/main/docs/configuration.md)
- [Known limitations](https://github.com/zouhairElMa/Healwright/blob/main/docs/limitations.md)
- [Security](https://github.com/zouhairElMa/Healwright/blob/main/docs/security.md)

## License

Apache-2.0. See `LICENSE` and `NOTICE` in this package.
