/**
 * Phase-17 real-Chromium checks: the telemetry must carry the exact Playwright locator the test
 * wrote (not a Selenium By.* annotation), and the report must know the test name. The backend is
 * the in-memory stand-in; telemetry goes to a temp report dir like a real run.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heal } from '../../src/playwright/wrapper.js';
import { RestClient } from '../../src/backend/rest-client.js';
import { inMemoryBackend } from './backend.js';
import type { InMemoryBackend } from './backend.js';

let browser: Browser;
let context: BrowserContext;
let page: Page;
let backend: InMemoryBackend;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  backend = inMemoryBackend();
  context = await browser.newContext();
  page = await context.newPage();
});
afterEach(async () => {
  await context.close();
});

function client(): RestClient {
  return new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'it-p17', fetch: backend.fetch });
}

function readEvents(dir: string, sessionId: string): Record<string, unknown>[] | null {
  try {
    const raw = readFileSync(join(dir, `${sessionId}.jsonl`), 'utf8').trim();
    return raw.length > 0 ? raw.split('\n').map((line) => JSON.parse(line)) : null;
  } catch {
    return null;
  }
}

/** JSONL writes are fire-and-forget: poll until the heal event lands. */
async function untilEvent(
  dir: string,
  sessionId: string,
  name: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const events = readEvents(dir, sessionId);
    const found = events?.find((event) => event.event === name);
    if (found !== undefined) {
      return found;
    }
    if (Date.now() > deadline) {
      throw new Error(`${name} not written within timeout`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Phase-17 telemetry expressions', () => {
  it('records the test name and page.locator() expressions (failed + healed)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hw-p17-'));
    try {
      await page.setContent(
        '<div id="main"><button id="submit" onclick="window.__clicks=(window.__clicks||0)+1">Submit</button></div>',
      );
      const healedPage = heal(page, {
        client: client(),
        className: 'IT',
        methodName: 'expr',
        reporting: true,
        reportDir: dir,
        sessionId: 'p17-page',
        testName: 'widget › heals the submit button',
        testFile: '/tests/widget.spec.ts',
      });

      await healedPage.locator('#submit').click({ timeout: 3000 });
      await page.evaluate(() => {
        document.querySelector('#submit')!.id = 'submit-new';
      });
      await healedPage.locator('#submit').click({ timeout: 3000 });

      const meta = await untilEvent(dir, 'p17-page', 'report.meta');
      expect(meta.testName).toBe('widget › heals the submit button');
      expect(meta.testFile).toBe('/tests/widget.spec.ts');

      const success = await untilEvent(dir, 'p17-page', 'heal.success');
      expect(success.playwright).toMatchObject({
        failed: "page.locator('#submit')",
        root: 'page',
        apis: ['locator'],
        healed: "page.locator('#submit-new')",
      });
      expect((success.playwright as Record<string, unknown>).callsite).toMatchObject({
        file: expect.stringContaining('phase17-expression.spec.ts'),
        line: expect.any(Number),
        column: expect.any(Number),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the frame root in both expressions for frameLocator-healed locators', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hw-p17-'));
    try {
      await page.setContent('<iframe id="f" width="400" height="300"></iframe>');
      await page.locator('#f').evaluate((el) => {
        (el as HTMLIFrameElement).srcdoc =
          '<html><body><div id="wrap"><input id="field"></div></body></html>';
      });
      await page.frameLocator('#f').locator('#field').waitFor({ state: 'attached', timeout: 5000 });

      const healedPage = heal(page, {
        client: client(),
        className: 'IT',
        methodName: 'expr-frame',
        reporting: true,
        reportDir: dir,
        sessionId: 'p17-frame',
        testName: 'frames › heals inside the iframe',
        testFile: '/tests/frames.spec.ts',
      });

      await healedPage.frameLocator('#f').locator('#field').fill('a', { timeout: 3000 });
      await page.frameLocator('#f').locator('#field').evaluate((el) => {
        (el as HTMLInputElement).id = 'field-new';
      });
      await healedPage.frameLocator('#f').locator('#field').fill('b', { timeout: 3000 });

      const success = await untilEvent(dir, 'p17-frame', 'heal.success');
      expect(success.playwright).toMatchObject({
        failed: "page.frameLocator('#f').locator('#field')",
        root: "page.frameLocator('#f')",
        apis: ['locator'],
        healed: "page.frameLocator('#f').locator('#field-new')",
      });
      expect((success.playwright as Record<string, unknown>).callsite).toMatchObject({
        file: expect.stringContaining('phase17-expression.spec.ts'),
        line: expect.any(Number),
        column: expect.any(Number),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
