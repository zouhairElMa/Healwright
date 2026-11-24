/**
 * Playwright wrapper (phase-2 option A). `heal(page)` returns a Page whose locator() yields
 * healing locators: an action that fails to resolve (TimeoutError with count 0, or strict-mode
 * ambiguity) triggers the engine and a SINGLE replay on the healed locator (phase-2 §6 structural
 * gap — Playwright combines find+action). A found-but-not-actionable timeout is NOT healed.
 * Successful actions persist the reference path (FindElementProcessor:21-26) so a later DOM
 * change can heal. Semantic getBy* locators and deep chaining parity are Phase-6 surfaces.
 * v1 gap (verified, now closed by Phase-6 assertionHealing): web-first assertions
 * (expect(locator).toBeVisible(), ...) resolve through the locator's internal _expect protocol,
 * which bypasses the action-method Proxy. Intercepting _expect (the single choke point every
 * matcher calls) lets a timed-out not-found assertion heal and replay the SAME matcher on the
 * healed locator. Disable via config.assertionHealing to restore v1 (assertions never heal).
 * Phase-6 frameHealing: page.frameLocator() returns a wrapped FrameLocator whose locators heal
 * inside the frame's document (frame-scoped adapter + replay scope), mirroring Healenium's
 * switchTo().frame() self-healing driver (TargetLocatorProxyInvocationHandler.java:37-38).
 * Disable via config.frameHealing to restore v1 (raw frame locators).
 * Phase-20: getBy* called directly on Page/FrameLocator is now wrapped too: the descriptor keeps
 * the Playwright expression as its backend key and carries a scope-level resolver out-of-band,
 * so the baseline reference is the target element itself (not the chain root).
 */
import type { Page, Locator as PlaywrightLocator, FrameLocator } from 'playwright';
import { randomUUID } from 'node:crypto';
import { HealingEngine } from '../engine/healing-engine.js';
import type { HealOutcome, PlaywrightLocatorInfo } from '../engine/healing-engine.js';
import { RestClient } from '../backend/rest-client.js';
import type { Locator } from '../backend/dto.js';
import { resolveConfig } from '../config/config.js';
import type { HealwrightConfig } from '../config/config.js';
import { silentLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { PlaywrightAdapter } from './adapter.js';
import { toPlaywrightSelector } from './selector-map.js';
import { withScopeResolver, scopeResolver, locatorKey, withLocatorKey } from './locator-resolver.js';
import { healedExpression, locatorCall, narrowRoot, withFrame, withStep } from './expression.js';
import type { LocatorExpression } from './expression.js';
import { captureCallsite } from './callsite.js';
import { requestAutoRewrite } from './source-rewrite.js';
import { identityDrift } from '../lcs/adaptive.js';
import type { ReferenceSnapshot } from '../lcs/adaptive.js';
import type { NeighborContextWire } from './capture.js';
import { SelectorType } from '../imitator/selector.js';
import { LocalReporter, nullReporter } from '../report/reporter.js';
import type { TelemetrySink } from '../report/reporter.js';

export interface HealOptions extends Partial<HealwrightConfig> {
  sessionId?: string;
  className?: string;
  methodName?: string;
  /** Playwright test title (testInfo.title); shown as the report name in the dashboard. */
  testName?: string;
  /** Playwright test file (testInfo.file); shown under the test name. */
  testFile?: string;
  client?: RestClient;
  logger?: Logger;
}

/** Session handle exposed on the healed page under `healwrightSession` (report lifecycle). */
export interface HealwrightSessionHandle {
  sessionId: string;
  /** Closes the Healwright report (POST /healenium/report/build); idempotent. */
  close: () => Promise<void>;
}

export const healwrightSession = Symbol.for('healwright.session');

/** page.locator()/frameLocator().locator() options that narrow which element is matched. */
interface LocatorOptions {
  has?: PlaywrightLocator;
  hasText?: string | RegExp;
  hasNot?: PlaywrightLocator;
  hasNotText?: string | RegExp;
}

const ACTION_METHODS = new Set([  'click',
  'dblclick',
  'fill',
  'press',
  'pressSequentially',
  'type',
  'check',
  'uncheck',
  'selectOption',
  'hover',
  'focus',
  'blur',
  'clear',
  'setInputFiles',
  'scrollIntoViewIfNeeded',
  'tap',
  'dispatchEvent',
  'dragTo',
  'selectText',
  'waitFor',
  'setChecked',
]);

/**
 * Phase-21: locator methods that read from the element and auto-wait for it (so they throw a
 * TimeoutError when it is missing) without being an action the user performed. They heal the same
 * way, but a successful read proves nothing about the baseline, so it is not persisted.
 * `count`, `allTextContents`, `isVisible` and `isHidden` are deliberately absent: they never wait
 * and never throw, so there is no failure to heal.
 */
const READ_METHODS = new Set([
  'inputValue',
  'getAttribute',
  'textContent',
  'innerText',
  'innerHTML',
  'evaluate',
  'evaluateAll',
  'evaluateHandle',
  'boundingBox',
  'screenshot',
  'isChecked',
  'isEnabled',
  'isDisabled',
  'isEditable',
  'elementHandle',
  'ariaSnapshot',
]);

const CHAIN_METHODS = new Set([
  'locator',
  'filter',
  'nth',
  'first',
  'last',
  'and',
  'or',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
]);

/** Phase-20: semantic locators callable on Page/FrameLocator (no selector string to key on). */
const SCOPE_SEMANTIC_METHODS = new Set([
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'getByTestId',
]);

interface WrapperContext {
  page: Page;
  /** Resolution scope for replay: the top page, or a FrameLocator for frame-scoped healing. */
  scope: Page | FrameLocator;
  engine: HealingEngine;
  adapter: PlaywrightAdapter;
  config: HealwrightConfig;
  className: string;
  methodName: string;
  client: RestClient;
  sessionId: string;
  logger: Logger;
  includeShadow: boolean;
  reporter: TelemetrySink;
  /** Resolution root used to rebuild Playwright expressions: `page` or `page.frameLocator(...)`. */
  playwrightRoot: string;
  closeSession: () => Promise<void>;
  /**
   * Phase-20 frame healing: called when an action failed and this scope lives in a frame. It
   * returns a context whose frame resolves again (re-healing the iframe element when its own
   * selector broke), the same context when the frame was never lost, or null when unrecoverable.
   */
  refreshFrame?: () => Promise<WrapperContext | null>;
  /** Persist the frame element reference once, so the frame itself can be healed later. */
  saveFrameReference?: () => Promise<void>;
}

export function heal(page: Page, options: HealOptions = {}): Page {
  const config = resolveConfig(options);
  if (!config.healEnabled) {
    return page;
  }
  if (config.actionTimeout !== undefined) {
    page.setDefaultTimeout(config.actionTimeout);
  }
  const logger = options.logger ?? silentLogger;
  const sessionId = options.sessionId ?? randomUUID();
  const client =
    options.client ??
    new RestClient({ serverUrl: config.serverUrl, sessionKey: sessionId, logger });
  const includeShadow = config.shadowHealing;
  const adapter = new PlaywrightAdapter(page, { includeShadow });
  const reporter = config.reporting
    ? new LocalReporter({ sessionId, dir: config.reportDir, logger })
    : nullReporter;
  const engine = new HealingEngine({ config, client, adapter, sessionId, logger, reporter });
  // Best-effort: load enable/disable maps; an unavailable backend must not block actions.
  void engine.loadSession().catch(() => undefined);

  // Automatic source rewrite runs once, at session end, on the completed JSONL file.
  // Report-only sessions stay read-only; backend refusals are recorded and never fail the test.
  const runAutoRewrite = async (): Promise<void> => {
    if (config.sourceRewrite !== 'auto' || config.reportOnly) {
      return;
    }
    if (!config.reporting) {
      logger.warn('[Rewrite] sourceRewrite=auto requires reporting=true; skipped (no session file).');
      return;
    }
    await reporter.flush?.();
    const outcome = await requestAutoRewrite({ serverUrl: config.serverUrl, sessionId });
    reporter.record({ event: outcome.ok ? 'rewrite.auto' : 'rewrite.failed', ...outcome });
    await reporter.flush?.();
  };

  let sessionClosed = false;
  const closeSession = config.reporting
    ? async (): Promise<void> => {
        if (sessionClosed) {
          return;
        }
        sessionClosed = true;
        reporter.record({ event: 'report.closing' });
        const path = await engine.closeReport();
        reporter.record({ event: 'report.closed', path });
        await runAutoRewrite();
      }
    : async (): Promise<void> => {};
  if (config.reporting) {
    reporter.record({ event: 'report.opening', serverUrl: config.serverUrl });
    // Phase-17: the dashboard names a report after the Playwright test instead of a timestamp.
    reporter.record({
      event: 'report.meta',
      testName: options.testName ?? null,
      testFile: options.testFile ?? null,
      className: options.className ?? 'healwright',
      methodName: options.methodName ?? 'action',
    });
    // The Healwright client opens one report per session before any healing; without this the
    // backend drops every report record ("[REPORT] Report not found for session ID").
    void engine.initReport().then((path) => reporter.record({ event: 'report.opened', path }));
  }

  const ctx: WrapperContext = {
    page,
    scope: page,
    engine,
    adapter,
    config,
    className: options.className ?? 'healwright',
    methodName: options.methodName ?? 'action',
    client,
    sessionId,
    logger,
    includeShadow,
    reporter,
    playwrightRoot: 'page',
    closeSession,
  };

  return wrapPage(page, ctx);
}

function wrapPage(page: Page, ctx: WrapperContext): Page {
  return new Proxy(page, {
    get(target, prop, receiver) {
      if (prop === healwrightSession) {
        const handle: HealwrightSessionHandle = { sessionId: ctx.sessionId, close: ctx.closeSession };
        return handle;
      }
      if (prop === 'close') {
        return async (...args: unknown[]) => {
          const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<unknown>;
          const result = await fn(...args);
          await ctx.closeSession();
          return result;
        };
      }
      if (prop === 'locator') {
        return (selector: string, options?: LocatorOptions) => {
          const real = target.locator(selector, options);
          const expression: LocatorExpression = {
            value: locatorCall(ctx.playwrightRoot, 'locator', [selector, options]),
            root: ctx.playwrightRoot,
            apis: ['locator'],
            callsite: captureCallsite() ?? undefined,
          };
          return wrapLocator(real, rootUserLocator(selector, options, ctx), ctx, expression);
        };
      }
      if (prop === 'frameLocator' && ctx.config.frameHealing) {
        return (selector: string) => {
          const frame = target.frameLocator(selector);
          return wrapFrameLocator(
            frame,
            frameContext(frame, ctx, {
              parent: ctx,
              element: userLocatorFromSelector(selector),
              reopen: (scope, element) => scope.frameLocator(toPlaywrightSelector(element)),
              // A frame root is keyed by its whole expression: two frames exposing the same
              // inner selector (`.save`) must not share one reference.
              key: {
                value: locatorCall(ctx.playwrightRoot, 'frameLocator', [selector]),
                type: SelectorType.BY_CSS_SELECTOR,
              },
              root: (parentRoot) => withFrame(parentRoot, selector).root,
            }),
          );
        };
      }
      if (typeof prop === 'string' && SCOPE_SEMANTIC_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const call = (target as unknown as Record<string, (...a: unknown[]) => PlaywrightLocator>)[prop];
          return wrapScopeSemantic(Reflect.apply(call!, target, args), prop, args, ctx);
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** How a frame was entered, enough to rebuild it after its own element changed. */
interface FrameEntry {
  /** Context that owns the element that opens the frame (the page, or the enclosing frame). */
  parent: WrapperContext;
  /**
   * The frame element as resolved in the parent scope: the iframe matched by frameLocator(), or
   * the chain element that contentFrame() was called on. Used to reopen and to re-locate it.
   */
  element?: Locator;
  /** Backend key of the frame element (its Playwright expression); defaults to `element`. */
  key?: Locator;
  /** Re-enter the frame from the parent's current scope given a (possibly healed) element. */
  reopen?: (parentScope: Page | FrameLocator, element: Locator) => FrameLocator;
  /** Expression root inside the parent, rebuilt from the parent's expression. */
  root: (parentRoot: string) => string;
}

/** Resolve a descriptor inside a concrete scope (getBy* descriptors carry their own resolver). */
function resolveIn(scope: Page | FrameLocator, locator: Locator): PlaywrightLocator {
  const resolver = scopeResolver(locator);
  return resolver !== undefined ? resolver(scope) : scope.locator(toPlaywrightSelector(locator));
}

/**
 * Phase-21: a locator reached from a Page or FrameLocator root. The backend key stays the bare
 * selector for a plain page-level `locator(selector)` — same key as before, so existing references
 * keep working — and becomes the whole expression as soon as the scope or the options change what
 * it matches: two frames exposing the same inner selector (`.save`) must not share one reference.
 * The value always stays the bare selector so imitation and disableHealingFor keep reading it.
 */
function rootUserLocator(
  selector: string,
  options: LocatorOptions | undefined,
  ctx: WrapperContext,
): Locator {
  const base = userLocatorFromSelector(selector);
  const locator = withScopeResolver(
    { value: base.value, type: base.type },
    (scope) => scope.locator(selector, options),
  );
  if (options === undefined && ctx.playwrightRoot === 'page') {
    return locator;
  }
  return withLocatorKey(locator, locatorCall(ctx.playwrightRoot, 'locator', [selector, options]));
}

/**
 * A locator for `parent.<method>(args)`. Its value stays the selector the step used (or the
 * parent's value for steps that take no selector), so imitation still regenerates that step; its
 * key is the whole expression, which is what keeps two chains apart.
 */
function chainUserLocator(
  parent: Locator,
  method: string,
  args: unknown[],
): Locator {
  const selector = method === 'locator' && typeof args[0] === 'string' ? args[0] : null;
  const value = selector === null ? parent : userLocatorFromSelector(selector);
  return withLocatorKey(
    withScopeResolver(
      { value: value.value, type: value.type },
      (scope) => {
        const resolvedParent = resolveIn(scope, parent);
        const fn = (resolvedParent as unknown as Record<string, (...a: unknown[]) => PlaywrightLocator>)[method];
        return Reflect.apply(fn!, resolvedParent, args);
      },
    ),
    locatorCall(locatorKey(parent), method, args),
  );
}

/**
 * Build a frame-scoped sibling context: a frame adapter (resolution/capture/content inside the
 * frame) and a HealingEngine sharing the same backend client/config/session. Mirrors Healenium
 * reusing the engine for the switched frame driver (TargetLocatorProxyInvocationHandler.java:38).
 *
 * Phase-20: the frame element is itself a reference. Healenium's switchTo().frame() locates the
 * iframe through the healing driver, so a renamed iframe is healed before the inner find. Here
 * the frame reference is captured on the first successful inner action and healing the frame
 * reopens the FrameLocator; the inner action then heals in the healthy document.
 */
function frameContext(frame: FrameLocator, base: WrapperContext, entry: FrameEntry): WrapperContext {
  const playwrightRoot = entry.root(base.playwrightRoot);
  const adapter = new PlaywrightAdapter(base.page, { includeShadow: base.includeShadow, frame });
  const engine = new HealingEngine({
    config: base.config,
    client: base.client,
    adapter,
    sessionId: base.sessionId,
    logger: base.logger,
    // Same sink as the page engine: frame-scoped healings must appear in the local telemetry
    // (and in reportOnly proposals), not vanish into the null reporter.
    reporter: base.reporter,
  });
  void engine.loadSession().catch(() => undefined);

  const frameElement = entry.element ?? null;
  const frameKey = entry.key ?? frameElement;
  let frameSaved = false;
  const saveFrameReference = async (): Promise<void> => {
    // Nested frames: every enclosing iframe needs its own reference too (the outer frame is
    // never the target of a user action, so only the inner action can capture the whole chain).
    if (entry.parent.saveFrameReference !== undefined) {
      await entry.parent.saveFrameReference();
    }
    if (frameElement === null || frameKey === null || frameSaved) {
      return;
    }
    try {
      const paths = await entry.parent.adapter.captureReference(frameElement);
      if (paths.length === 0) {
        return;
      }
      frameSaved = true;
      await entry.parent.engine.saveReference({
        locator: frameKey,
        command: 'findElement',
        className: entry.parent.className,
        methodName: 'frameLocator',
        paths,
      });
    } catch {
      // Best-effort, like every other reference save.
    }
  };

  const ctx: WrapperContext = {
    ...base,
    scope: frame,
    engine,
    adapter,
    playwrightRoot,
    saveFrameReference,
  };
  ctx.refreshFrame = () => refreshFrame(ctx, entry);
  return ctx;
}

async function frameAlive(frame: FrameLocator): Promise<boolean> {
  return (await frame.locator('html').count().catch(() => 0)) > 0;
}

/**
 * Re-locate this frame after an action failed: refresh the parent chain first (nested frames),
 * then the frame itself. A frame entered through an element (frameLocator selector, or the element
 * contentFrame() was called on) is healed like any element, from the reference captured at
 * baseline; a narrowed frame (first/last/nth) has no element key and only inherits a refreshed
 * parent.
 */
async function refreshFrame(current: WrapperContext, entry: FrameEntry): Promise<WrapperContext | null> {
  let parent = entry.parent;
  if (parent.refreshFrame !== undefined) {
    const refreshed = await parent.refreshFrame();
    if (refreshed === null) {
      return null;
    }
    parent = refreshed;
  }
  if (entry.reopen === undefined || entry.element === undefined) {
    return parent === entry.parent ? current : null;
  }
  const reopened = entry.reopen(parent.scope, entry.element);
  if (await frameAlive(reopened)) {
    return parent === entry.parent ? current : frameContext(reopened, parent, entry);
  }
  const healed = await healFrameElement(parent, entry.key ?? entry.element);
  if (healed === null) {
    return null;
  }
  const next = entry.reopen(parent.scope, healed.locator);
  if (!(await frameAlive(next))) {
    return null;
  }
  current.reporter.record({
    event: 'frame.healed',
    failedFrame: current.playwrightRoot,
    healedFrame: toPlaywrightSelector(healed.locator),
    score: healed.score,
  });
  return frameContext(next, parent, { ...entry, parent, element: healed.locator });
}

/** Heal the frame element itself in the parent scope and return its new locator. */
async function healFrameElement(
  parent: WrapperContext,
  element: Locator,
): Promise<{ locator: Locator; score: number } | null> {
  try {
    const outcome = await parent.engine.heal({
      locator: element,
      command: 'findElement',
      className: parent.className,
      methodName: 'frameLocator',
      notFound: true,
      playwright: {
        failed: element.value,
        root: parent.playwrightRoot,
        apis: ['frameLocator'],
        formatHealed: (locator) =>
          locatorCall(parent.playwrightRoot, 'frameLocator', [toPlaywrightSelector(locator)]),
      },
    });
    if (outcome === null) {
      return null;
    }
    return { locator: outcome.selector, score: outcome.score };
  } catch {
    // A frame torn down mid-flight (or an unreachable parent document) cannot be healed here.
    return null;
  }
}

function wrapFrameLocator(frame: FrameLocator, ctx: WrapperContext): FrameLocator {
  const target = frame as unknown as Record<string, unknown>;
  return new Proxy(frame, {
    get(_target, prop, receiver) {
      if (prop === 'locator') {
        return (selector: string | PlaywrightLocator, options?: LocatorOptions) => {
          const real = frame.locator(selector, options);
          // Only string selectors carry a healable user locator value; a passed Locator has no
          // public selector string, so it is returned raw (no reference key to heal against).
          if (typeof selector !== 'string') {
            return real;
          }
          const expression: LocatorExpression = {
            value: locatorCall(ctx.playwrightRoot, 'locator', [selector, options]),
            root: ctx.playwrightRoot,
            apis: ['locator'],
            callsite: captureCallsite() ?? undefined,
          };
          return wrapLocator(real, rootUserLocator(selector, options, ctx), ctx, expression);
        };
      }
      if (prop === 'frameLocator') {
        return (selector: string) => {
          const nested = frame.frameLocator(selector);
          return wrapFrameLocator(
            nested,
            frameContext(nested, ctx, {
              parent: ctx,
              element: userLocatorFromSelector(selector),
              reopen: (scope, element) => scope.frameLocator(toPlaywrightSelector(element)),
              key: {
                value: locatorCall(ctx.playwrightRoot, 'frameLocator', [selector]),
                type: SelectorType.BY_CSS_SELECTOR,
              },
              root: (parentRoot) => withFrame(parentRoot, selector).root,
            }),
          );
        };
      }
      if (prop === 'first' || prop === 'last' || prop === 'nth') {
        return (...args: unknown[]) => {
          const fn = target[prop] as (...a: unknown[]) => FrameLocator;
          const next = fn.apply(frame, args);
          // A narrowed frame has no element key of its own: it can only inherit a refreshed parent.
          return wrapFrameLocator(next, frameContext(next, ctx, { parent: ctx, root: (parentRoot) => narrowRoot(parentRoot, prop, args) }));
        };
      }
      if (typeof prop === 'string' && SCOPE_SEMANTIC_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const call = (frame as unknown as Record<string, (...a: unknown[]) => PlaywrightLocator>)[prop];
          return wrapScopeSemantic(Reflect.apply(call!, frame, args), prop, args, ctx);
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(frame) : value;
    },
  }) as unknown as FrameLocator;
}

function userLocatorFromSelector(selector: string): Locator {
  // The engine re-applies the "xpath=" prefix when resolving a By.xpath locator, so the stored
  // value must be the bare expression; keeping the prefix produced "xpath=xpath=..." and the
  // reference capture (evaluateAll) silently failed for every explicit "xpath=" locator.
  const explicitXPath = selector.startsWith('xpath=');
  const isXPath = explicitXPath || selector.startsWith('//') || selector.startsWith('(');
  return {
    value: explicitXPath ? selector.slice('xpath='.length) : selector,
    type: isXPath ? SelectorType.BY_XPATH : SelectorType.BY_CSS_SELECTOR,
  };
}

/**
 * Phase-20: a getBy* call has no selector string, so the backend key is the Playwright
 * expression (e.g. "page.getByRole('button', { name: 'Save' })") and resolution goes through
 * the scope (Page or FrameLocator) captured at call time.
 */
function wrapScopeSemantic(
  real: PlaywrightLocator,
  method: string,
  args: unknown[],
  ctx: WrapperContext,
): PlaywrightLocator {
  const value = locatorCall(ctx.playwrightRoot, method, args);
  const userLocator: Locator = withScopeResolver(
    { value, type: SelectorType.BY_CSS_SELECTOR },
    (scope) => {
      const call = (scope as unknown as Record<string, (...a: unknown[]) => PlaywrightLocator>)[method];
      return Reflect.apply(call!, scope, args);
    },
  );
  const expression: LocatorExpression = {
    value,
    root: ctx.playwrightRoot,
    apis: [method],
    callsite: captureCallsite() ?? undefined,
  };
  return wrapLocator(real, userLocator, ctx, expression);
}

/** Phase-17: pass the rebuilt expression plus the healed-locator formatter to the engine. */
function toPlaywrightInfo(expression: LocatorExpression): PlaywrightLocatorInfo {
  return {
    failed: expression.value,
    root: expression.root,
    apis: expression.apis,
    ...(expression.callsite === undefined ? {} : { callsite: expression.callsite }),
    formatHealed: (locator) => healedExpression(expression.root, toPlaywrightSelector(locator)),
  };
}

function wrapLocator(
  real: PlaywrightLocator,
  userLocator: Locator,
  ctx: WrapperContext,
  expression: LocatorExpression,
): PlaywrightLocator {
  // Phase-20: a frame refresh replaces the Playwright locator bound to a dead FrameLocator, so
  // every later action on this wrapper resolves through the current object, not the original.
  let current: PlaywrightLocator = real;
  // Phase-21: the backend key never changes (it is the expression the test wrote). References and
  // the identity snapshot are re-written against this key from whatever element was last acted
  // on, so a healed action re-baselines the true element instead of the decoy.
  const key = userLocator;

  /** Phase-21: capture the baseline from the element an action actually succeeded on. */
  const persistReference = async (
    active: WrapperContext,
    resolved: PlaywrightLocator,
  ): Promise<void> => {
    try {
      if (active.saveFrameReference !== undefined) {
        await active.saveFrameReference();
      }
      const paths = await active.adapter.captureReferenceFrom(resolved);
      await active.engine.saveReference({
        locator: key,
        command: 'findElement',
        className: active.className,
        methodName: active.methodName,
        paths,
      });
      // Phase-16 adaptive: the neighbour context must be read while the element is still the one
      // the user located. Kept in-process only; healenium/improved skip this extra DOM read.
      if (active.config.scoring === 'adaptive') {
        const context = await active.adapter.captureContextFrom(resolved);
        if (context !== null) {
          active.engine.rememberReferenceContext(key, toSnapshot(context));
        }
      }
    } catch {
      // Reference saving is best-effort, mirroring RestClient.saveElements swallowing errors.
    }
  };

  /** Run one locator method on a given Playwright locator (the wrapper may have re-resolved it). */
  const invoke = async (locator: PlaywrightLocator, method: string, args: unknown[]): Promise<unknown> => {
    const fn = (locator as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
    return Reflect.apply(fn!, locator, args);
  };

  const scoped = (active: WrapperContext, locator: Locator): PlaywrightLocator =>
    resolveIn(active.scope, locator);

  /**
   * Phase-21 identity guard. A locator that still resolves — but to a decoy the broken DOM left
   * behind — never fails, so nothing would trigger healing and the action would silently hit the
   * wrong element. When the captured identity drifted while the count is exactly 1, ask the engine
   * whether another element matches the reference better. A null outcome means the engine agreed
   * the current element is the right one, so the original locator is used unchanged.
   */
  const guardIdentity = async (
    active: WrapperContext,
  ): Promise<{ locator: PlaywrightLocator; healed: HealOutcome | null } | null> => {
    if (!active.config.identityGuard || active.config.healEnabled === false) {
      return null;
    }
    // A positional (.nth/.first/.last) or filtered chain states which element is wanted: the user
    // asked for a position, so identity drift is the intent, not a decoy.
    if (expression.apis.some((api) => api === 'nth' || api === 'first' || api === 'last' ||
      api === 'filter' || api === 'and' || api === 'or')) {
      return null;
    }
    const snapshot = active.engine.referenceSnapshot(key);
    const before = snapshot?.self;
    if (before === undefined) {
      return null;
    }
    if ((await current.count().catch(() => 0)) !== 1) {
      return null;
    }
    const now = await active.adapter.identityOf(current);
    if (now === null || !identityDrift(before, now)) {
      return null;
    }
    const currentElementId = await active.adapter.elementIdOf(current);
    const outcome = await active.engine.heal({
      locator: key,
      command: 'findElement',
      className: active.className,
      methodName: active.methodName,
      notFound: true,
      currentElementId: currentElementId ?? undefined,
      playwright: toPlaywrightInfo(expression),
    });
    if (outcome === null) {
      active.reporter.record({
        event: 'identity.kept',
        reason: 'guard-confirmed',
        method: 'action',
        playwright: toPlaywrightInfo(expression),
      });
      return null;
    }
    const healed = scoped(active, outcome.selector);
    active.reporter.record({
      event: 'identity.redirected',
      healedLocator: outcome.telemetry.healedLocator,
      score: outcome.telemetry.score,
      drifted: { tag: now.tag, id: now.id, text: now.text },
      playwright: outcome.telemetry.playwright,
    });
    return { locator: healed, healed: outcome };
  };

  const runAction = async (method: string, args: unknown[], persist: boolean): Promise<unknown> => {
    let target = current;
    try {
      const guarded = persist ? await guardIdentity(ctx) : null;
      if (guarded !== null) {
        target = guarded.locator;
      }
      const result = await invoke(target, method, args);
      if (persist) {
        await persistReference(ctx, target);
      }
      return result;
    } catch (err) {
      let active = ctx;
      let error: unknown = err;
      let failure = await classifyFailure(err, target);
      if (failure.healable && ctx.refreshFrame !== undefined) {
        // The failure may be the frame itself (renamed/moved iframe): re-open it first, then
        // replay the original inner action in the healthy document.
        const refreshed = await ctx.refreshFrame();
        if (refreshed === null) {
          ctx.reporter.record({
            event: 'action.failed',
            method,
            healable: failure.healable,
            error: messageOf(err),
            playwright: {
              failed: expression.value,
              root: expression.root,
              apis: expression.apis,
              healed: null,
            },
          });
          throw err;
        }
        if (refreshed !== ctx) {
          active = refreshed;
          current = scoped(refreshed, key);
          try {
            const result = await invoke(current, method, args);
            if (persist) {
              await persistReference(active, current);
            }
            return result;
          } catch (retryErr) {
            error = retryErr;
            failure = await classifyFailure(retryErr, current);
          }
        }
      }
      if (failure.healable) {
        const outcome = await active.engine.heal({
          locator: key,
          command: 'findElement',
          className: active.className,
          methodName: active.methodName,
          notFound: failure.notFound,
          playwright: toPlaywrightInfo(expression),
        });
        if (outcome !== null) {
          const healed = scoped(active, outcome.selector);
          try {
            const replayed = await invoke(healed, method, args);
            // Phase-21: the baseline now describes the healed element. Saving the original
            // locator's reference here would record the decoy it may still resolve to.
            if (persist) {
              await persistReference(active, healed);
            }
            active.reporter.record({
              event: 'replay.ok',
              method,
              healedLocator: outcome.telemetry.healedLocator,
              score: outcome.telemetry.score,
              playwright: outcome.telemetry.playwright,
            });
            return replayed;
          } catch (replayErr) {
            active.reporter.record({
              event: 'replay.failed',
              method,
              healedLocator: outcome.telemetry.healedLocator,
              error: messageOf(replayErr),
              playwright: outcome.telemetry.playwright,
            });
            throw replayErr;
          }
        }
      }
      ctx.reporter.record({
        event: 'action.failed',
        method,
        healable: failure.healable,
        error: messageOf(error),
        playwright: {
          failed: expression.value,
          root: expression.root,
          apis: expression.apis,
          healed: null,
        },
      });
      throw error;
    }
  };

  const runExpect = async (args: unknown[]): Promise<unknown> => {
    let active = ctx;
    // Phase-21: a decoy that still matches turns a "toBeVisible" into a false pass. The guard
    // redirects the matcher before it runs, exactly like an action.
    const guarded = await guardIdentity(ctx);
    if (guarded !== null) {
      const healedFn = expectHook(guarded.locator, 'healed locator');
      const replayed = await healedFn.apply(guarded.locator, args);
      const isNot = Boolean((args[1] as { isNot?: boolean } | undefined)?.isNot);
      if (replayed.matches === !isNot) {
        active.reporter.record({
          event: 'replay.ok',
          method: '_expect',
          healedLocator: guarded.healed?.telemetry.healedLocator ?? null,
          score: guarded.healed?.telemetry.score ?? null,
          playwright: guarded.healed?.telemetry.playwright,
        });
        await persistReference(ctx, guarded.locator);
        return replayed;
      }
    }
    let result = await expectHook(current, 'locator').apply(current, args);
    const isNot = Boolean((args[1] as { isNot?: boolean } | undefined)?.isNot);
    // Playwright semantics: the assertion passes iff matches === !isNot (toBeTruthy matcher).
    if (result.matches === !isNot) {
      await persistReference(active, current);
      return result;
    }
    // Failed assertion: heal only a timed-out not-found locator. A .not failure means the element
    // is present (count > 0); a found-but-not-matching element also has count > 0 — neither heals.
    if (result.timedOut) {
      let count = await current.count().catch(() => 0);
      if (count === 0 && ctx.refreshFrame !== undefined) {
        // Phase-20: the frame may be the missing element; re-open it and retry the same matcher.
        const refreshed = await ctx.refreshFrame();
        if (refreshed !== null && refreshed !== ctx) {
          active = refreshed;
          current = scoped(refreshed, key);
          result = await expectHook(current, 'assertion').apply(current, args);
          if (result.matches === !isNot) {
            ctx.reporter.record({ event: 'replay.ok', method: '_expect', healedLocator: null });
            return result;
          }
          count = 0;
        }
      }
      if (count === 0) {
        const outcome = await active.engine.heal({
          locator: key,
          command: 'findElement',
          className: active.className,
          methodName: active.methodName,
          notFound: true,
          playwright: toPlaywrightInfo(expression),
        });
        if (outcome !== null) {
          const healed = scoped(active, outcome.selector);
          const healedFn = expectHook(healed, 'healed locator');
          const replayed = await healedFn.apply(healed, args);
          active.reporter.record({
            event: 'replay.ok',
            method: '_expect',
            healedLocator: outcome.telemetry.healedLocator,
            score: outcome.telemetry.score,
            playwright: outcome.telemetry.playwright,
          });
          return replayed;
        }
      }
    }
    return result;
  };

  return new Proxy(real, {
    get(_target, prop, receiver) {
      if (typeof prop === 'string' && ACTION_METHODS.has(prop)) {
        return (...args: unknown[]) => runAction(prop, args, true);
      }
      if (typeof prop === 'string' && READ_METHODS.has(prop)) {
        // A read heals on failure but is not an action: it must not move the baseline.
        return (...args: unknown[]) => runAction(prop, args, false);
      }
      if (prop === '_expect' && ctx.config.assertionHealing) {
        return (...args: unknown[]) => runExpect(args);
      }
      if (prop === 'contentFrame' && ctx.config.frameHealing) {
        return () => {
          const frame = (current as unknown as { contentFrame: () => FrameLocator }).contentFrame();
          return wrapFrameLocator(
            frame,
            frameContext(frame, ctx, {
              parent: ctx,
              element: key,
              reopen: (scope, element) => resolveIn(scope, element).contentFrame(),
              root: () => locatorCall(expression.value, 'contentFrame', []),
            }),
          );
        };
      }
      if (typeof prop === 'string' && CHAIN_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const fn = (current as unknown as Record<string, (...a: unknown[]) => PlaywrightLocator>)[prop]!;
          const next = Reflect.apply(fn, current, args);
          return wrapLocator(
            next,
            chainUserLocator(key, prop, args),
            ctx,
            withStep(expression, prop, args),
          );
        };
      }
      const value = Reflect.get(current as unknown as Record<PropertyKey, unknown>, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(current) : value;
    },
  }) as unknown as PlaywrightLocator;
}

/** Phase-21: wire capture -> the in-process snapshot the adaptive decision reads. */
function toSnapshot(context: NeighborContextWire): ReferenceSnapshot {
  return {
    index: context.index,
    siblingCount: context.siblingCount,
    prev: context.prev,
    next: context.next,
    self: context.self,
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * locator._expect is a Playwright internal (not part of the public API). The guard turns a silent
 * breakage after a Playwright upgrade into an actionable error (T4b).
 */
function expectHook(locator: unknown, where: string): (...a: unknown[]) => Promise<ExpectResult> {
  const fn = (locator as Record<string, unknown>)['_expect'];
  if (typeof fn !== 'function') {
    throw new Error(
      `Healwright: locator._expect is missing on the ${where} (Playwright internals changed). ` +
        'Web-first assertion healing is unsupported on this Playwright version; ' +
        're-validate test/integration/assertion.spec.ts and update the tested range.',
    );
  }
  return fn as (...a: unknown[]) => Promise<ExpectResult>;
}

/** Resolved value of locator._expect (it never rejects; the expect wrapper throws on failure). */
interface ExpectResult {
  matches: boolean;
  timedOut?: boolean;
  received?: unknown;
  log?: string[];
  errorMessage?: string;
}

interface FailureClassification {
  healable: boolean;
  notFound: boolean;
}

async function classifyFailure(err: unknown, real: PlaywrightLocator): Promise<FailureClassification> {
  if (err instanceof Error) {
    // Strict-mode ambiguity is a resolution failure new to Playwright (phase-2 §8.4); heal it.
    if (err.message.includes('strict mode violation')) {
      return { healable: true, notFound: true };
    }
    if (err.name === 'TimeoutError') {
      const count = await real.count().catch(() => 0);
      // count 0 => not found (heal); count > 0 => found but not actionable (do not heal).
      return { healable: count === 0, notFound: count === 0 };
    }
  }
  return { healable: false, notFound: false };
}