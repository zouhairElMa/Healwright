/**
 * Phase-20: page/frame-level Playwright semantic locators (getByRole, getByText, getByLabel,
 * getByPlaceholder, getByAltText, getByTitle, getByTestId) have no selector string the backend
 * could key on, yet they must be captured (baseline reference) and healed like `locator()`.
 * The descriptor keeps its wire shape (value/type) and carries the real resolver out-of-band in
 * a WeakMap, so it never leaks into JSON sent to the backend or into the telemetry.
 */
import type { FrameLocator, Locator as PlaywrightLocator, Page } from 'playwright';
import type { Locator } from '../backend/dto.js';

export type ScopeLocatorResolver = (scope: Page | FrameLocator) => PlaywrightLocator;

const resolvers = new WeakMap<Locator, ScopeLocatorResolver>();

export function withScopeResolver<T extends Locator>(locator: T, resolver: ScopeLocatorResolver): T {
  resolvers.set(locator, resolver);
  return locator;
}

export function scopeResolver(locator: Locator): ScopeLocatorResolver | undefined {
  return resolvers.get(locator);
}

export { locatorKey, withLocatorKey } from '../model/locator-key.js';
