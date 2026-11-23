/**
 * Playwright implementation of the engine's BrowserAdapter. Couples the pure HealingEngine to
 * a real Page: capture via evaluateAll (itemsWithAttributes port), candidate HTML via
 * page.content(), uniqueness via a DOM fingerprint (no Selenium element id exists in Playwright),
 * and screenshot via page.screenshot() with optional backlight border (SelfHealingEngine:156-162).
 *
 * Shadow DOM (Phase-6 shadowHealing): when enabled, the candidate HTML comes from
 * serializeWithShadow, which inlines open shadow roots as host children so parse5 traverses them,
 * and the reference path crosses shadow boundaries (capture.ts). page.content({includeShadow:true})
 * alone is insufficient — it emits <template shadowrootmode> that parse5 never attaches. Disabled
 * (includeShadow false) restores v1 plain page.content() (Healenium parity: no shadow DOM support).
 * Closed roots and slots are out of scope.
 *
 * Frames (Phase-6 frameHealing): when a FrameLocator is supplied, resolution, reference capture,
 * uniqueness and candidate HTML all run inside the frame's document (frame.locator('html')
 * outerHTML), mirroring Healenium wrapping switchTo().frame() into a self-healing driver
 * (TargetLocatorProxyInvocationHandler.java:37-38). currentUrl and the screenshot still use the
 * top page; the reference key excludes the url by default (Utils.buildKey), so the top url is a
 * faithful parity choice. Frame content does not embed shadow roots (frame+shadow is out of scope).
 */
import type { Page, Locator as PlaywrightLocator, FrameLocator } from 'playwright';
import type { BrowserAdapter } from '../engine/healing-engine.js';
import type { Locator } from '../backend/dto.js';
import type { Node } from '../model/node.js';
import { elementFingerprint } from './fingerprint.js';
import {
  captureElementIdentity,
  captureNeighborContext,
  captureReferencePaths,
  itemsToNodePaths,
  serializeWithShadow,
} from './capture.js';
import type { ElementIdentityWire, NeighborContextWire } from './capture.js';
import { toPlaywrightSelector } from './selector-map.js';
import { scopeResolver } from './locator-resolver.js';

export interface PlaywrightAdapterOptions {
  includeShadow?: boolean;
  /** When set, resolution/capture/content run inside this frame instead of the top page. */
  frame?: FrameLocator;
}

export class PlaywrightAdapter implements BrowserAdapter {
  private readonly page: Page;
  private readonly includeShadow: boolean;
  private readonly frame: FrameLocator | null;
  private readonly scope: Page | FrameLocator;

  constructor(page: Page, options: PlaywrightAdapterOptions = {}) {
    this.page = page;
    this.includeShadow = options.includeShadow ?? false;
    this.frame = options.frame ?? null;
    this.scope = options.frame ?? page;
  }

  resolve(locator: Locator): PlaywrightLocator {
    // Phase-20: page/frame-level getBy* carry their real resolver out-of-band.
    const resolver = scopeResolver(locator);
    if (resolver !== undefined) {
      return resolver(this.scope);
    }
    return this.scope.locator(toPlaywrightSelector(locator));
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async pageContent(): Promise<string> {
    if (this.frame !== null) {
      // Self-contained callback: serialized into the frame context, no module closure.
      return this.frame.locator('html').evaluate((element) => element.outerHTML);
    }
    return this.includeShadow ? this.page.evaluate(serializeWithShadow) : this.page.content();
  }

  async count(locator: Locator): Promise<number> {
    return this.resolve(locator).count();
  }

  async uniqueElementId(locator: Locator): Promise<string | null> {
    const resolved = this.resolve(locator);
    if ((await resolved.count()) !== 1) {
      return null;
    }
    // Pass the function itself: Playwright serializes the callback source into the browser,
    // so it must not close over a module binding (an arrow wrapper would reference an
    // undefined import in the page context).
    return resolved.evaluate(elementFingerprint);
  }

  async captureScreenshot(locator: Locator, backlight: boolean): Promise<string> {
    if (backlight) {
      const resolved = this.resolve(locator);
      if ((await resolved.count()) === 1) {
        // The border is a visual aid for the report: the page must look untouched afterwards,
        // otherwise every healed element keeps a red outline for the rest of the test run. The
        // original style attribute is restored verbatim (and removed when there was none).
        const previous = await resolved.evaluate((element) => {
          const html = element as HTMLElement;
          const before = html.getAttribute('style');
          html.style.border = '3px solid red';
          return before;
        });
        try {
          const buffer = await this.page.screenshot({ caret: 'initial' });
          return buffer.toString('base64');
        } finally {
          await resolved
            .evaluate((element, original) => {
              const html = element as HTMLElement;
              if (original === null) {
                html.removeAttribute('style');
              } else {
                html.setAttribute('style', original);
              }
            }, previous)
            .catch(() => undefined);
        }
      }
    }
    const buffer = await this.page.screenshot({ caret: 'initial' });
    return buffer.toString('base64');
  }

  /** Capture root->target reference paths for the matched element(s) (FindElementProcessor save). */
  async captureReference(locator: Locator): Promise<Node[][]> {
    const items = await this.resolve(locator).evaluateAll(captureReferencePaths);
    return itemsToNodePaths(items);
  }

  /** Phase-16 adaptive: capture the unique matched element's neighbour context, or null. */
  async captureContext(locator: Locator): Promise<NeighborContextWire | null> {
    return this.captureContextFrom(this.resolve(locator));
  }

  /** Phase-21 sticky locator: same capture, from a Playwright locator already resolved. */
  async captureContextFrom(resolved: PlaywrightLocator): Promise<NeighborContextWire | null> {
    if ((await resolved.count()) !== 1) {
      return null;
    }
    return resolved.evaluate(captureNeighborContext);
  }

  /** Phase-21 sticky locator: reference paths of an already resolved Playwright locator. */
  async captureReferenceFrom(resolved: PlaywrightLocator): Promise<Node[][]> {
    const items = await resolved.evaluateAll(captureReferencePaths);
    return itemsToNodePaths(items);
  }

  /** Phase-21 identity guard: DOM fingerprint of the unique element a locator resolves to. */
  async elementIdOf(resolved: PlaywrightLocator): Promise<string | null> {
    if ((await resolved.count()) !== 1) {
      return null;
    }
    return resolved.evaluate(elementFingerprint);
  }

  /** Phase-21 identity guard: identity of the unique element a locator resolves to. */
  async identityOf(resolved: PlaywrightLocator): Promise<ElementIdentityWire | null> {
    if ((await resolved.count()) !== 1) {
      return null;
    }
    return resolved.evaluate(captureElementIdentity);
  }
}