/**
 * Real-Chromium integration tests for the Playwright wrapper (phase-2 option A). The backend is
 * an in-memory stand-in (./backend.ts); the real PostgreSQL/Java backend is exercised in Phase 5.
 * These prove the structural claims that unit tests cannot: a successful action persists a real
 * captured reference, a not-found failure heals and REPLAYS the action once on the healed locator,
 * and a found-but-not-actionable timeout is NOT healed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { heal } from '../../src/playwright/wrapper.js';
import { RestClient } from '../../src/backend/rest-client.js';
import { inMemoryBackend, referenceKey } from './backend.js';
import type { InMemoryBackend } from './backend.js';

const BUTTON = '<div id="main"><button id="submit" onclick="window.__clicks=(window.__clicks||0)+1">Submit</button></div>';

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
  await page.setContent(BUTTON);
});

afterEach(async () => {
  await context.close();
});

function client(): RestClient {
  return new RestClient({
    serverUrl: 'http://localhost:7878',
    sessionKey: 'it-session',
    fetch: backend.fetch,
  });
}

function clicks(): Promise<number> {
  return page.evaluate(() => (window as unknown as { __clicks?: number }).__clicks ?? 0);
}

describe('heal(page) — golden path: heal + single replay', () => {
  it('persists a reference on success, then heals a renamed id and replays the click', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'golden' });

    await healedPage.locator('#submit').click({ timeout: 3000 });
    expect(await clicks()).toBe(1);

    const key = referenceKey('#submit', 'IT', 'golden', 'findElement', 'about:blank');
    expect(backend.references.has(key)).toBe(true);
    expect(backend.references.get(key)![0]!.at(-1)!.id).toBe('submit');

    await page.evaluate(() => {
      document.querySelector('#submit')!.id = 'submit-new';
    });

    await healedPage.locator('#submit').click({ timeout: 3000 });
    expect(await clicks()).toBe(2);

    expect(backend.healingCalls).toHaveLength(1);
    const dto = backend.healingCalls[0]![0]!;
    expect(dto.locator).toBe('#submit');
    expect(dto.usedResult?.locator.value).toBe('#submit-new');
    expect(dto.usedResult?.locator.type).toBe('By.cssSelector');
    expect(dto.usedResult?.score).toBeGreaterThanOrEqual(0.6);
  });

  it('binds passthrough Page methods (evaluate) to the real page', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'passthrough' });
    const title = await healedPage.evaluate(() => document.querySelector('#submit')!.textContent);
    expect(title).toBe('Submit');
  });
});

describe('heal(page) — failure classification', () => {
  it('does NOT heal a found-but-not-actionable (disabled) timeout; rethrows the original error', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'disabled' });
    await healedPage.locator('#submit').click({ timeout: 3000 });
    expect(await clicks()).toBe(1);

    await page.evaluate(() => {
      (document.querySelector('#submit') as HTMLButtonElement).disabled = true;
    });

    await expect(healedPage.locator('#submit').click({ timeout: 1500 })).rejects.toThrow();
    expect(await clicks()).toBe(1);
    expect(backend.healingCalls).toHaveLength(0);
  });

  it('rethrows the original error when no reference exists', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'noreference' });
    await page.evaluate(() => {
      document.querySelector('#submit')!.id = 'submit-new';
    });

    await expect(healedPage.locator('#submit').click({ timeout: 1500 })).rejects.toThrow();
    expect(await clicks()).toBe(0);
    expect(backend.healingCalls).toHaveLength(0);
  });

  it('does NOT heal a locally disabled locator even when a reference exists', async () => {
    const healedPage = heal(page, {
      client: client(),
      className: 'IT',
      methodName: 'localdisable',
      disableHealingFor: ['#submit'],
    });
    await healedPage.locator('#submit').click({ timeout: 3000 });
    expect(await clicks()).toBe(1);

    await page.evaluate(() => {
      document.querySelector('#submit')!.id = 'submit-new';
    });

    await expect(healedPage.locator('#submit').click({ timeout: 1500 })).rejects.toThrow();
    expect(await clicks()).toBe(1);
    expect(backend.healingCalls).toHaveLength(0);
  });

  it('heals a strict-mode violation by disambiguating to the unique referenced element', async () => {
    await page.setContent(
      '<div id="main"><button id="submit" class="real" onclick="window.__clicks=(window.__clicks||0)+1">Submit</button></div>',
    );
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'strict' });
    await healedPage.locator('#submit').click({ timeout: 3000 });
    expect(await clicks()).toBe(1);

    // A second element with the same id makes #submit ambiguous (Playwright strict mode).
    await page.evaluate(() => {
      const decoy = document.createElement('button');
      decoy.id = 'submit';
      decoy.className = 'decoy';
      decoy.textContent = 'Decoy';
      document.querySelector('#main')!.appendChild(decoy);
    });

    await healedPage.locator('#submit').click({ timeout: 3000 });
    expect(await clicks()).toBe(2);
    expect(backend.healingCalls).toHaveLength(1);
    expect(backend.healingCalls[0]![0]!.usedResult?.locator.value).not.toBe('#submit');
  });
});

describe('heal(page) — locator syntax coverage', () => {
  it('persists and heals an explicit xpath= locator without doubling the prefix', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'xpathprefix' });
    await healedPage.locator('xpath=//div[@id="main"]/button').click({ timeout: 3000 });
    expect(await clicks()).toBe(1);

    const key = referenceKey('//div[@id="main"]/button', 'IT', 'xpathprefix', 'findElement', 'about:blank');
    expect(backend.references.has(key)).toBe(true);

    await page.evaluate(() => {
      document.querySelector('#main')!.id = 'main-new';
    });

    await healedPage.locator('xpath=//div[@id="main"]/button').click({ timeout: 3000 });
    expect(await clicks()).toBe(2);
    expect(backend.healingCalls).toHaveLength(1);
  });

  it('replays pressSequentially on the healed input', async () => {
    await page.setContent('<div id="form"><input id="city"></div>');
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'pressseq' });
    await healedPage.locator('#city').pressSequentially('Rabat', { timeout: 3000 });

    await page.evaluate(() => {
      document.querySelector('#city')!.id = 'city-new';
    });

    await healedPage.locator('#city').pressSequentially('!', { timeout: 3000 });
    expect(await page.inputValue('#city-new')).toBe('Rabat!');
    expect(backend.healingCalls).toHaveLength(1);
  });
});

describe('heal(page) — disabled', () => {
  it('returns the identical page when healing is disabled', () => {
    const result = heal(page, { healEnabled: false });
    expect(result).toBe(page);
  });
});
/**
 * Phase-21. The two fragilities these cover were measured on the locator-chaos lab: a chain that
 * shares its last selector with another chain healed onto the other chain's element, and a decoy
 * that still matched the locator made the action succeed on the wrong element (nothing failed, so
 * nothing healed).
 */
describe('heal(page) — phase-21 chain keys and identity guard', () => {
  it('keeps chained locators apart: each chain heals its own element', async () => {
    await page.setContent(
      '<div id="row-a"><button class="btn" onclick="window.__a=(window.__a||0)+1">A</button></div>' +
        '<div id="row-b"><button class="btn" onclick="window.__b=(window.__b||0)+1">B</button></div>',
    );
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'chain' });
    const chain = healedPage.locator('#row-a').locator('.btn');
    await chain.click({ timeout: 3000 });
    await healedPage.locator('#row-b').locator('.btn').click({ timeout: 3000 });
    expect(backend.references.size).toBe(2);

    // The row id changes: the chain no longer resolves, and `.btn` alone would match row-b's
    // button. Only the chain's own reference identifies row-a's button.
    await page.evaluate(() => {
      document.querySelector('#row-a')!.id = 'row-a2';
    });

    await healedPage.locator('#row-a').locator('.btn').click({ timeout: 3000 });
    expect(await page.evaluate(() => (window as unknown as { __a?: number }).__a ?? 0)).toBe(2);
    expect(await page.evaluate(() => (window as unknown as { __b?: number }).__b ?? 0)).toBe(1);
    expect(backend.healingCalls).toHaveLength(1);
    expect(backend.healingCalls[0]![0]!.locator).toBe("#row-a.locator('.btn')");
  });

  it('redirects a decoy that still matches, using the captured neighbourhood', async () => {
    await page.setContent(
      '<div id="main"><span id="lab">First</span>' +
        '<button class="act" data-bench-id="k1" onclick="window.__real=(window.__real||0)+1">Pay</button>' +
        '<span id="tail">x</span></div><div id="other"></div>',
    );
    const healedPage = heal(page, {
      client: client(),
      className: 'IT',
      methodName: 'decoy',
      scoring: 'adaptive',
    });
    await healedPage.locator('.act').click({ timeout: 3000 });
    expect(await page.evaluate(() => (window as unknown as { __real?: number }).__real ?? 0)).toBe(1);

    // The real button loses the class (a DOM change) and a decoy wearing it appears elsewhere:
    // `.act` still resolves — to the wrong element.
    await page.evaluate(() => {
      const real = document.querySelector('#main button')!;
      real.className = 'act-renamed';
      const decoy = document.createElement('button');
      decoy.className = 'act';
      decoy.setAttribute('data-bench-id', 'k2');
      decoy.textContent = 'Pay';
      decoy.addEventListener('click', () => {
        const w = window as unknown as { __decoy?: number };
        w.__decoy = (w.__decoy ?? 0) + 1;
      });
      document.querySelector('#other')!.appendChild(decoy);
    });

    await healedPage.locator('.act').click({ timeout: 3000 });
    expect(await page.evaluate(() => (window as unknown as { __decoy?: number }).__decoy ?? 0)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __real?: number }).__real ?? 0)).toBe(2);
  });
});
