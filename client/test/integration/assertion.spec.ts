/**
 * Real-Chromium integration tests for Phase-6 assertionHealing (in-memory backend). Uses the real
 * Playwright expect from @playwright/test, whose web-first matchers all call locator._expect. These
 * prove: a passing assertion persists a reference; a renamed id makes toBeVisible/toHaveText time out
 * (not found) and HEAL + replay the same matcher; disabling assertionHealing restores v1 (no heal);
 * a found-but-not-matching element and a failing negated (.not) assertion are NOT healed (count > 0).
 */
import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect as vexpect } from 'vitest';
import { expect } from '@playwright/test';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { heal } from '../../src/playwright/wrapper.js';
import { RestClient } from '../../src/backend/rest-client.js';
import { inMemoryBackend } from './backend.js';
import type { InMemoryBackend } from './backend.js';

const BUTTON = '<div id="main"><button id="submit">Submit</button></div>';

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
  return new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'it-assert', fetch: backend.fetch });
}

async function renameSubmit(): Promise<void> {
  await page.evaluate(() => {
    document.querySelector('#submit')!.id = 'submit-new';
  });
}

describe('heal(page) — web-first assertions heal (assertionHealing)', () => {
  it('toBeVisible heals a renamed id and replays the matcher', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'visible' });
    await expect(healedPage.locator('#submit')).toBeVisible({ timeout: 3000 });
    vexpect(backend.references.size).toBe(1);

    await renameSubmit();
    await expect(healedPage.locator('#submit')).toBeVisible({ timeout: 1500 });

    vexpect(backend.healingCalls).toHaveLength(1);
    vexpect(backend.healingCalls[0]![0]!.usedResult?.locator.value).toBe('#submit-new');
  });

  it('toHaveText heals a renamed id and replays the matcher', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'text' });
    await expect(healedPage.locator('#submit')).toHaveText('Submit', { timeout: 3000 });
    vexpect(backend.references.size).toBe(1);

    await renameSubmit();
    await expect(healedPage.locator('#submit')).toHaveText('Submit', { timeout: 1500 });

    vexpect(backend.healingCalls).toHaveLength(1);
    vexpect(backend.healingCalls[0]![0]!.usedResult?.locator.value).toBe('#submit-new');
  });
});

describe('heal(page) — assertions not healed when ineligible', () => {
  it('does NOT heal assertions when assertionHealing is disabled (v1 behavior)', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'off', assertionHealing: false });
    await expect(healedPage.locator('#submit')).toBeVisible({ timeout: 3000 });
    await renameSubmit();
    await vexpect(expect(healedPage.locator('#submit')).toBeVisible({ timeout: 1500 })).rejects.toThrow();
    vexpect(backend.healingCalls).toHaveLength(0);
  });

  it('does NOT heal a found-but-not-matching element (count > 0)', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'mismatch' });
    await expect(healedPage.locator('#submit')).toHaveText('Submit', { timeout: 3000 });
    // Element still present but text changed: a mismatch, not a not-found failure.
    await page.evaluate(() => {
      document.querySelector('#submit')!.textContent = 'Changed';
    });
    await vexpect(expect(healedPage.locator('#submit')).toHaveText('Submit', { timeout: 1500 })).rejects.toThrow();
    vexpect(backend.healingCalls).toHaveLength(0);
  });

  it('does NOT heal a failing negated assertion (element present, count > 0)', async () => {
    const healedPage = heal(page, { client: client(), className: 'IT', methodName: 'negated' });
    await expect(healedPage.locator('#submit')).toBeVisible({ timeout: 3000 });
    // #submit is visible, so .not.toBeVisible() fails because the element IS present.
    await vexpect(expect(healedPage.locator('#submit')).not.toBeVisible({ timeout: 1500 })).rejects.toThrow();
    vexpect(backend.healingCalls).toHaveLength(0);
  });
});