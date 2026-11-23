import { describe, it, expect } from 'vitest';
import { toPlaywrightSelector } from '../src/playwright/selector-map.js';
import { SelectorType } from '../src/imitator/selector.js';
import type { Locator } from '../src/backend/dto.js';

function loc(type: string, value: string): Locator {
  return { type, value };
}

describe('toPlaywrightSelector', () => {
  it('passes CSS selectors through unchanged', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_CSS_SELECTOR, '#main > button.x'))).toBe(
      '#main > button.x',
    );
  });

  it('prefixes XPath with the Playwright xpath engine', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_XPATH, '//button[@id="x"]'))).toBe(
      'xpath=//button[@id="x"]',
    );
  });

  it('maps By.id to an attribute selector', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_ID, 'submit'))).toBe('[id="submit"]');
  });

  it('maps By.className to a class selector', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_CLASS_NAME, 'primary'))).toBe('.primary');
  });

  it('maps By.tagName to the tag itself', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_TAG_NAME, 'button'))).toBe('button');
  });

  it('maps By.name to a name attribute selector', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_NAME, 'email'))).toBe('[name="email"]');
  });

  it('maps By.linkText to an exact text engine on anchors', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_LINK_TEXT, 'Sign in'))).toBe(
      'a:text-is("Sign in")',
    );
  });

  it('maps By.partialLinkText to a substring text engine on anchors', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_PARTIAL_LINK_TEXT, 'Sign'))).toBe(
      'a:has-text("Sign")',
    );
  });

  it('escapes backslashes and double quotes in attribute values', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_ID, 'a"b\\c'))).toBe('[id="a\\"b\\\\c"]');
    expect(toPlaywrightSelector(loc(SelectorType.BY_NAME, 'x"y'))).toBe('[name="x\\"y"]');
  });

  it('escapes double quotes in text-engine selectors', () => {
    expect(toPlaywrightSelector(loc(SelectorType.BY_LINK_TEXT, 'say "hi"'))).toBe(
      'a:text-is("say \\"hi\\"")',
    );
  });

  it('falls back to the raw value for an unknown type', () => {
    expect(toPlaywrightSelector(loc('By.unknown', '#raw'))).toBe('#raw');
  });
});