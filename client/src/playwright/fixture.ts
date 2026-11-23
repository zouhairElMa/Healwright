/**
 * @playwright/test integration. `import { test, expect } from '@zouhair/healwright/test'` gives a
 * `healedPage` fixture — the built-in `page` wrapped by heal() — plus a `healOptions` option
 * (default {}) overridable via test.use()/config to inject a RestClient, sessionId, className,
 * methodName, or any HealwrightConfig field. The fixture names the Healwright report after the
 * running test (testInfo.title/file) unless healOptions overrides testName/testFile. This module
 * imports @playwright/test at runtime, so it lives behind the "./test" subpath export (the main
 * entry stays Playwright-runtime-free).
 */
import { test as base, expect } from '@playwright/test';
import type { Page } from 'playwright';
import { heal, healwrightSession } from './wrapper.js';
import type { HealOptions, HealwrightSessionHandle } from './wrapper.js';

export type HealwrightOptions = { healOptions: HealOptions };
export type HealwrightFixtures = { healedPage: Page };

export const test = base.extend<HealwrightOptions & HealwrightFixtures>({
  healOptions: [{}, { option: true }],
  healedPage: async ({ page, healOptions }, use, testInfo) => {
    // Phase-17: the report is named after the Playwright test. An explicit healOptions
    // testName/testFile wins (spread after the defaults), e.g. a labelled variant.
    const healed = heal(page, {
      testName: testInfo.title,
      testFile: testInfo.file,
      ...healOptions,
    });
    await use(healed);
    // Close the Healwright report at test end (POST /healenium/report/build), mirroring the
    // legacy agent's session-end call; best-effort and idempotent with page close.
    const session = (healed as unknown as Record<symbol, HealwrightSessionHandle | undefined>)[
      healwrightSession
    ];
    await session?.close();
  },
});

export { expect };