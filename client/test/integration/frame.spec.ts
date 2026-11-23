/**
 * Real-Chromium integration tests for Phase-6 frameHealing. The backend is the in-memory stand-in
 * (./backend.ts). These prove the structural claim that page.frameLocator() locators heal INSIDE
 * the frame document: a successful frame action persists a frame-scoped reference, a renamed id
 * heals and REPLAYS within the frame (not the top page), nested frames heal, and disabling
 * frameHealing restores v1 (raw frame locators, no healing). Healenium parity:
 * switchTo().frame() becomes a self-healing driver (TargetLocatorProxyInvocationHandler.java:37-38).
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
  await page.setContent('<iframe id="f" width="400" height="300"></iframe>');
});
afterEach(async () => {
  await context.close();
});

function client(): RestClient {
  return new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'it-frame', fetch: backend.fetch });
}

/** Load a self-contained document into the top iframe #f and wait for its input. */
async function loadFrame(): Promise<void> {
  await page.locator('#f').evaluate((el) => {
    (el as HTMLIFrameElement).srcdoc =
      '<html><body><div id="wrap"><input id="field" name="fn"></div></body></html>';
  });
  await page.frameLocator('#f').locator('#field').waitFor({ state: 'attached', timeout: 5000 });
}

describe('heal(page).frameLocator() — golden path: heal + replay inside the frame', () => {
  it('persists a frame reference, then heals a renamed id and replays within the frame', async () => {
    await loadFrame();
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'frame' });

    await healedPage.frameLocator('#f').locator('#field').fill('a', { timeout: 3000 });
    expect(await page.frameLocator('#f').locator('#field').inputValue()).toBe('a');
    // Phase-20/21: the iframe element is a reference of its own, and frame-scoped locators are
    // keyed by their expression so two frames exposing the same inner selector stay apart.
    expect(backend.references.size).toBe(2);

    await page.frameLocator('#f').locator('#field').evaluate((el) => {
      (el as HTMLInputElement).id = 'field-new';
    });

    await healedPage.frameLocator('#f').locator('#field').fill('b', { timeout: 3000 });
    expect(await page.frameLocator('#f').locator('#field-new').inputValue()).toBe('b');

    expect(backend.healingCalls).toHaveLength(1);
    const dto = backend.healingCalls[0]![0]!;
    expect(dto.locator).toBe("page.frameLocator('#f').locator('#field')");
    expect(dto.usedResult?.locator.value).toBe('#field-new');
    expect(dto.usedResult?.score).toBeGreaterThanOrEqual(0.6);
  });

  it('heals inside a nested frame (frameLocator().frameLocator())', async () => {
    await page.locator('#f').evaluate((el) => {
      (el as HTMLIFrameElement).srcdoc =
        '<html><body><iframe id="g" width="300" height="200"></iframe></body></html>';
    });
    await page.frameLocator('#f').locator('#g').evaluate((el) => {
      (el as HTMLIFrameElement).srcdoc = '<html><body><input id="nested"></body></html>';
    });
    await page.frameLocator('#f').frameLocator('#g').locator('#nested').waitFor({ state: 'attached', timeout: 5000 });

    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'nested' });
    await healedPage.frameLocator('#f').frameLocator('#g').locator('#nested').fill('a', { timeout: 3000 });

    await page.frameLocator('#f').frameLocator('#g').locator('#nested').evaluate((el) => {
      (el as HTMLInputElement).id = 'nested-new';
    });

    await healedPage.frameLocator('#f').frameLocator('#g').locator('#nested').fill('b', { timeout: 3000 });
    expect(await page.frameLocator('#f').frameLocator('#g').locator('#nested-new').inputValue()).toBe('b');
    expect(backend.healingCalls).toHaveLength(1);
    expect(backend.healingCalls[0]![0]!.usedResult?.locator.value).toBe('#nested-new');
  });
});

describe('heal(page).frameLocator() — disabled (v1 behavior)', () => {
  it('does NOT heal frame locators when frameHealing is false', async () => {
    await loadFrame();
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'off', frameHealing: false });

    await healedPage.frameLocator('#f').locator('#field').fill('a', { timeout: 3000 });
    // Raw frame locator: no reference is persisted on success.
    expect(backend.references.size).toBe(0);

    await page.frameLocator('#f').locator('#field').evaluate((el) => {
      (el as HTMLInputElement).id = 'field-new';
    });

    await expect(healedPage.frameLocator('#f').locator('#field').fill('b', { timeout: 1500 })).rejects.toThrow();
    expect(backend.healingCalls).toHaveLength(0);
  });
});