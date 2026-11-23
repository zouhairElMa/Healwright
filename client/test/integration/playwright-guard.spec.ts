/**
 * T4b — guards around the Playwright internals Healwright depends on.
 *
 * `locator._expect` is not public API: web-first assertion healing intercepts it
 * (src/playwright/wrapper.ts). If a Playwright upgrade removes or reshapes the hook, these tests
 * must fail with an actionable message rather than let healing silently stop working.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

const require = createRequire(import.meta.url);
const installed = (require('playwright/package.json') as { version: string }).version;

/** Range validated against the real-Chromium suites in this repository. */
const TESTED = { major: 1, minor: 65 };

function expectHookMessage(where: string): string {
  return (
    `locator._expect is missing on the ${where} (Playwright ${installed}). ` +
    `Healwright tested the hook on ${TESTED.major}.${TESTED.minor}.x only; ` +
    're-validate test/integration/assertion.spec.ts, then update the tested range in docs/limites.md.'
  );
}

describe('Playwright guards (T4b)', () => {
  it(`runs on the tested Playwright range (${TESTED.major}.${TESTED.minor}.x)`, () => {
    const [major, minor] = installed.split('.').map(Number);
    expect(
      major === TESTED.major && minor === TESTED.minor,
      `Playwright ${installed} is outside the tested range ${TESTED.major}.${TESTED.minor}.x. ` +
        'locator._expect is an internal hook used by src/playwright/wrapper.ts; ' +
        're-run this spec and test/integration/assertion.spec.ts before widening the range.',
    ).toBe(true);
  });

  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setContent('<div id="main"><button id="submit">Submit</button></div>');
  });
  afterAll(async () => {
    await browser.close();
  });

  it('exposes locator._expect on a page locator', () => {
    const locator = page.locator('#submit');
    expect(typeof (locator as unknown as Record<string, unknown>)['_expect'], expectHookMessage('page locator')).toBe(
      'function',
    );
  });

  it('exposes locator._expect on a frame locator', () => {
    const locator = page.mainFrame().locator('#submit');
    expect(typeof (locator as unknown as Record<string, unknown>)['_expect'], expectHookMessage('frame locator')).toBe(
      'function',
    );
  });

  it('resolves _expect to the {matches, timedOut} shape used by the wrapper', async () => {
    const locator = page.locator('#submit');
    const hook = (locator as unknown as Record<string, unknown>)['_expect'] as (
      expression: string,
      options: Record<string, unknown>,
    ) => Promise<{ matches: boolean; timedOut?: boolean }>;
    const result = await hook.call(locator, 'to.be.visible', {
      isNot: false,
      timeout: 1000,
      expectedValue: undefined,
    });
    expect(typeof result.matches, 'locator._expect no longer resolves to {matches}').toBe('boolean');
    expect(result.matches).toBe(true);
  });
});
