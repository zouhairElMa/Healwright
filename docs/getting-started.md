---
layout: default
title: Getting started
---

# Getting started

## 1. Install the client

```bash
npm install @zouhair_elmattad/healwright
npm install -D playwright @playwright/test
npx playwright install chromium
```

Node.js 20 or newer is required. Playwright 1.40 or newer is supported; 1.65.x is the locally verified range.

## 2. Start PostgreSQL and the backend

Create a PostgreSQL database and user, then set the environment variables described in the [backend guide](backend.md).

```bash
java -jar healwright-backend-3.5.1.jar
```

Verify the backend:

```bash
curl --fail http://localhost:7878/actuator/health
curl --fail http://localhost:7878/api/config
```

Open <http://localhost:7878/> for the dashboard.

## 3. Wrap a Playwright page

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

## 4. Or use the Playwright fixture

```ts
import { test, expect } from '@zouhair_elmattad/healwright/test';

test.use({ healOptions: { serverUrl: 'http://localhost:7878' } });

test('submits after a DOM change', async ({ healedPage }) => {
  await healedPage.locator('#submit').click();
  await expect(healedPage.locator('#submit')).toBeVisible();
});
```

## 5. Diagnose the stack

```bash
npx healwright-doctor
```

The doctor checks Node.js, Java, PostgreSQL connectivity, backend health, and dashboard availability.

## Next steps

- [API reference](api.md)
- [Configuration](configuration.md)
- [Reporting](reporting.md)
- [Known limitations](limitations.md)
