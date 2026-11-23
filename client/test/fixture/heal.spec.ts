/**
 * End-to-end test of the healwright/test fixture under the real @playwright/test runner.
 * The healedPage fixture must wrap the built-in page so a renamed id heals and replays.
 * Backend is the same in-memory stand-in used by the vitest integration suite (Phase 5 uses
 * the real PostgreSQL/Java backend). Imports are source-relative; Playwright transpiles TS.
 */
import { test, expect } from '../../src/playwright/fixture.js';
import { RestClient } from '../../src/backend/rest-client.js';
import { inMemoryBackend } from '../integration/backend.js';

const backend = inMemoryBackend();

test.use({
  healOptions: {
    client: new RestClient({
      serverUrl: 'http://localhost:7878',
      sessionKey: 'fixture-session',
      fetch: backend.fetch,
    }),
    className: 'FixtureIT',
    methodName: 'heal',
  },
});

test.beforeEach(() => {
  backend.references.clear();
  backend.healingCalls.length = 0;
});

test('healedPage fixture heals a renamed id and replays the click', async ({ healedPage, page }) => {
  await page.setContent(
    '<div id="main"><button id="submit" onclick="window.__clicks=(window.__clicks||0)+1">Submit</button></div>',
  );

  await healedPage.locator('#submit').click({ timeout: 3000 });
  expect(await page.evaluate(() => (window as unknown as { __clicks?: number }).__clicks ?? 0)).toBe(1);

  await page.evaluate(() => {
    document.querySelector('#submit')!.id = 'submit-new';
  });

  await healedPage.locator('#submit').click({ timeout: 3000 });
  expect(await page.evaluate(() => (window as unknown as { __clicks?: number }).__clicks ?? 0)).toBe(2);
  expect(backend.healingCalls).toHaveLength(1);
  expect(backend.healingCalls[0]![0]!.usedResult?.locator.value).toBe('#submit-new');
});