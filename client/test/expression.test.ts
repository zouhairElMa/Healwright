/**
 * Phase-17: the dashboard shows the Playwright locator the test actually wrote, so the
 * reconstruction must be faithful: quoting, semantic APIs, frames, chaining, and an explicit
 * "…" for opaque arguments (a Locator passed to filter/has cannot be rebuilt from source).
 */
import { describe, it, expect } from 'vitest';
import {
  healedExpression,
  locatorCall,
  narrowRoot,
  quote,
  stringifyArg,
  withFrame,
  withStep,
} from '../src/playwright/expression.js';

describe('quote', () => {
  it('escapes backslashes and single quotes', () => {
    expect(quote("#a'b\\c")).toBe("'#a\\'b\\\\c'");
  });
});

describe('stringifyArg', () => {
  it('renders strings, numbers, booleans and regexes as source', () => {
    expect(stringifyArg('Save')).toBe("'Save'");
    expect(stringifyArg(2)).toBe('2');
    expect(stringifyArg(false)).toBe('false');
    expect(stringifyArg(/^save$/i)).toBe('/^save$/i');
  });

  it('renders option objects with unquoted identifier keys', () => {
    expect(stringifyArg({ name: 'Save', exact: true })).toBe("{ name: 'Save', exact: true }");
    expect(stringifyArg({ hasText: 'Save' })).toBe("{ hasText: 'Save' }");
  });

  it('replaces an opaque locator argument instead of guessing it', () => {
    class FakeLocator {
      toString(): string { return 'internal'; }
    }
    expect(stringifyArg({ has: new FakeLocator() })).toBe('{ has: … }');
  });
});

describe('locator chains', () => {
  it('rebuilds page.locator + semantic getBy* steps', () => {
    const base = { value: locatorCall('page', 'locator', ['#save']), root: 'page', apis: ['locator'] };
    expect(base.value).toBe("page.locator('#save')");
    const role = withStep(base, 'getByRole', ['button', { name: 'Save' }]);
    expect(role.value).toBe("page.locator('#save').getByRole('button', { name: 'Save' })");
    expect(role.apis).toEqual(['locator', 'getByRole']);
  });

  it('rebuilds a nested locator chain and narrowing steps', () => {
    const base = { value: locatorCall('page', 'locator', ['.row']), root: 'page', apis: ['locator'] };
    const nested = withStep(base, 'locator', ['button']);
    const narrowed = withStep(nested, 'nth', [1]);
    expect(narrowed.value).toBe("page.locator('.row').locator('button').nth(1)");
  });

  it('rebuilds a frame root and keeps it for the healed expression', () => {
    const frame = withFrame('page', '#f');
    expect(frame.root).toBe("page.frameLocator('#f')");
    const inside = {
      value: locatorCall(frame.root, 'locator', ['#save']),
      root: frame.root,
      apis: ['locator'],
    };
    expect(inside.value).toBe("page.frameLocator('#f').locator('#save')");
    expect(healedExpression(inside.root, 'button.save')).toBe(
      "page.frameLocator('#f').locator('button.save')",
    );
    expect(narrowRoot("page.frameLocator('#f')", 'nth', [2])).toBe(
      "page.frameLocator('#f').nth(2)",
    );
  });

  it('keeps an XPath healed selector inside the locator call', () => {
    expect(healedExpression('page', 'xpath=//button')).toBe("page.locator('xpath=//button')");
  });
});
