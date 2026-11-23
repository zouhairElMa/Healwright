/**
 * Map a Healenium Locator {type,value} to a Playwright selector string. The stored type uses
 * the Selenium By.toString() prefix "By.*" (ByDefaultMapper splits "By.cssSelector: #x" on ":";
 * StackUtils.BY_MAP:32-40 keys are "By.*"). CSS and XPath are the native Playwright engines;
 * the other By types are best-effort CSS/text-engine equivalents (v1 heals CSS primarily).
 */
import type { Locator } from '../backend/dto.js';
import { SelectorType } from '../imitator/selector.js';

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function toPlaywrightSelector(locator: Locator): string {
  switch (locator.type) {
    case SelectorType.BY_CSS_SELECTOR:
      return locator.value;
    case SelectorType.BY_XPATH:
      return `xpath=${locator.value}`;
    case SelectorType.BY_ID:
      return `[id="${escapeAttributeValue(locator.value)}"]`;
    case SelectorType.BY_CLASS_NAME:
      return `.${locator.value}`;
    case SelectorType.BY_TAG_NAME:
      return locator.value;
    case SelectorType.BY_NAME:
      return `[name="${escapeAttributeValue(locator.value)}"]`;
    case SelectorType.BY_LINK_TEXT:
      return `a:text-is("${escapeAttributeValue(locator.value)}")`;
    case SelectorType.BY_PARTIAL_LINK_TEXT:
      return `a:has-text("${escapeAttributeValue(locator.value)}")`;
    default:
      return locator.value;
  }
}