/**
 * Real-Chromium integration tests for Phase-6 shadowHealing (in-memory backend). Healenium has no
 * shadow DOM support, so this is a pure improvement. These prove: an open shadow element heals and
 * REPLAYS (reference path crosses the host boundary; candidate HTML inlines the open shadow root);
 * disabling shadowHealing restores v1 (plain page.content, no shadow candidate => no heal); and a
 * closed shadow root is a gap (Playwright CSS does not pierce it, so it cannot even be located).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
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
  await page.setContent('<div id="host"></div>');
});
afterEach(async () => {
  await context.close();
});

function client(): RestClient {
  return new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'it-shadow', fetch: backend.fetch });
}

async function attachShadow(mode: 'open' | 'closed'): Promise<void> {
  await page.evaluate((m) => {
    const host = document.querySelector('#host')!;
    const root = host.attachShadow({ mode: m });
    root.innerHTML = '<div id="wrap"><input id="shadow-field" name="sf"></div>';
  }, mode);
}

async function renameShadowField(): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector('#host')!;
    // Open root is reachable via host.shadowRoot; reach the input through the pierced locator.
    const input = host.shadowRoot!.querySelector('#shadow-field') as HTMLInputElement;
    input.id = 'shadow-field-new';
  });
}

describe('heal(page) — open shadow DOM (shadowHealing improvement)', () => {
  it('persists a host-crossing reference, then heals a renamed shadow id and replays', async () => {
    await attachShadow('open');
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'shadow' });

    await healedPage.locator('#shadow-field').fill('a', { timeout: 3000 });
    expect(await page.locator('#shadow-field').inputValue()).toBe('a');
    expect(backend.references.size).toBe(1);
    // The reference path includes the host chain (crosses the shadow boundary).
    const path = [...backend.references.values()][0]![0]!;
    expect(path.map((n) => n.id)).toContain('host');
    expect(path.at(-1)!.id).toBe('shadow-field');

    await renameShadowField();

    await healedPage.locator('#shadow-field').fill('b', { timeout: 3000 });
    expect(await page.locator('#shadow-field-new').inputValue()).toBe('b');
    expect(backend.healingCalls).toHaveLength(1);
    expect(backend.healingCalls[0]![0]!.usedResult?.locator.value).toBe('#shadow-field-new');
    expect(backend.healingCalls[0]![0]!.usedResult?.score).toBeGreaterThanOrEqual(0.6);
  });

  it('does NOT heal shadow elements when shadowHealing is disabled (v1 behavior)', async () => {
    await attachShadow('open');
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'off', shadowHealing: false });

    await healedPage.locator('#shadow-field').fill('a', { timeout: 3000 });
    await renameShadowField();

    await expect(healedPage.locator('#shadow-field').fill('b', { timeout: 1500 })).rejects.toThrow();
    expect(backend.healingCalls).toHaveLength(0);
  });
});

describe('heal(page) — closed shadow DOM (gap)', () => {
  it('cannot locate or heal a closed shadow root (Playwright CSS does not pierce it)', async () => {
    await attachShadow('closed');
    expect(await page.locator('#shadow-field').count()).toBe(0);
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'closed' });
    await expect(healedPage.locator('#shadow-field').fill('a', { timeout: 1500 })).rejects.toThrow();
    expect(backend.healingCalls).toHaveLength(0);
  });
});