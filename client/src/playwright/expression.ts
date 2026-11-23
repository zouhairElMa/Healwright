/**
 * Phase-17: rebuild the Playwright locator expression the test actually wrote
 * (page.locator(...).getByRole(...), page.frameLocator(...).locator(...), ...).
 * Playwright exposes no public selector string for a Locator, so the wrapper reconstructs
 * the chain from the calls it proxies. Display-only: the healing key (Locator {type,value})
 * is unchanged, and an opaque argument (a Locator passed to filter/has) is rendered as "…"
 * rather than guessed.
 */

import type { SourceLocation } from './callsite.js';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A locator chain: the expression, the resolution root, and the APIs used in order. */
export interface LocatorExpression {
  /** e.g. `page.frameLocator('#f').locator('#save').getByRole('button', { name: 'Save' })` */
  value: string;
  /** e.g. `page` or `page.frameLocator('#f')` — where the healed locator must be replayed. */
  root: string;
  /** e.g. ['frameLocator', 'locator', 'getByRole'] */
  apis: string[];
  /** Phase-24: where the test wrote this chain; carried to telemetry for source write-back. */
  callsite?: SourceLocation;
}

export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Render a call argument as JavaScript source, without guessing opaque values. */
export function stringifyArg(value: unknown): string {
  if (typeof value === 'string') {
    return quote(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringifyArg).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      // Class instance (Playwright Locator, JSHandle, ...): not rebuildable from source.
      return '…';
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${IDENTIFIER.test(key) ? key : quote(key)}: ${stringifyArg(item)}`);
    return `{ ${entries.join(', ')} }`;
  }
  // Functions and symbols cannot appear in a locator expression either.
  return '…';
}

export function locatorCall(expression: string, method: string, args: unknown[]): string {
  const rendered = args.filter((arg) => arg !== undefined).map(stringifyArg).join(', ');
  return `${expression}.${method}(${rendered})`;
}

export function withStep(expression: LocatorExpression, method: string, args: unknown[]): LocatorExpression {
  return {
    value: locatorCall(expression.value, method, args),
    root: expression.root,
    apis: [...expression.apis, method],
    ...(expression.callsite === undefined ? {} : { callsite: expression.callsite }),
  };
}

/** Enter a frame from a Page/FrameLocator root; the new chain roots inside that frame. */
export function withFrame(
  rootExpression: string,
  selector: string,
  callsite?: SourceLocation,
): LocatorExpression {
  const root = locatorCall(rootExpression, 'frameLocator', [selector]);
  return { value: root, root, apis: ['frameLocator'], ...(callsite === undefined ? {} : { callsite }) };
}

/** A frameLocator narrowed by first()/last()/nth(): same root, updated expression. */
export function narrowRoot(rootExpression: string, method: string, args: unknown[]): string {
  return locatorCall(rootExpression, method, args);
}

/** Expression replayed on a healed backend selector, in the original Playwright scope. */
export function healedExpression(rootExpression: string, selector: string): string {
  return locatorCall(rootExpression, 'locator', [selector]);
}
