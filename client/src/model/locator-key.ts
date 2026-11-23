/**
 * Phase-21: the backend reference key of a locator, kept apart from its value. The value stays the
 * last selector the test wrote (imitation and disableHealingFor keep working on it), while the key
 * is the whole Playwright expression — two chains ending on the same selector used to share one
 * reference and could replay each other's element. Kept in a WeakMap so it never leaks into the
 * DTOs the caller builds, and falls back to the value when unset.
 */
import type { Locator } from '../backend/dto.js';

const keys = new WeakMap<Locator, string>();

export function withLocatorKey<T extends Locator>(locator: T, key: string): T {
  keys.set(locator, key);
  return locator;
}

export function locatorKey(locator: Locator): string {
  return keys.get(locator) ?? locator.value;
}
