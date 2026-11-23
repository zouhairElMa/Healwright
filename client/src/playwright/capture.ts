/**
 * Reference path capture — port of itemsWithAttributes.js (healenium-web resources) run via
 * locator.evaluateAll. Walks root->target, index = rank among element siblings, classes = raw
 * class attribute split(' ') (NodeService.toNode deserializes straight into a Set, no trim/filter;
 * NodeBuilder.setClasses:87-88 assigns it unchanged). This preserves the reference/candidate
 * asymmetry: the candidate tree (parse5/Jsoup) trim/filters classes, the reference does not.
 *
 * Phase-6 shadowHealing: the walk crosses open shadow-root boundaries (getRootNode().host) so a
 * shadow element's reference path includes the host chain. This stays consistent with the
 * candidate serializer (serializeWithShadow) that inlines open shadow roots as host children.
 * For non-shadow elements getRootNode() is the Document (no host), so v1 behavior is unchanged.
 * Closed shadow roots and slots are out of scope.
 */
import { Node } from '../model/node.js';

export interface CapturedNode {
  tag: string;
  id: string;
  index: number;
  classes: string[];
  other: Record<string, string>;
  innerText: string;
}

/**
 * Browser-context function (serialized into evaluateAll). One path per matched element,
 * each ordered root->target. Stops at the html element (parentElement null), matching the
 * original script which stops when parentNode reaches document.
 */
export function captureReferencePaths(elements: Element[]): CapturedNode[][] {
  return elements.map((element) => {
    const items: CapturedNode[] = [];
    let current: Element | null = element;
    while (current !== null) {
      let index = 0;
      let sibling = current.previousElementSibling;
      while (sibling !== null) {
        index++;
        sibling = sibling.previousElementSibling;
      }
      const classAttribute = current.getAttribute('class');
      const classes = classAttribute !== null ? classAttribute.split(' ') : [];
      const other: Record<string, string> = {};
      for (const attr of Array.from(current.attributes)) {
        if (attr.name !== 'id' && attr.name !== 'class') {
          other[attr.name] = attr.value;
        }
      }
      const html = current as HTMLElement;
      items.unshift({
        tag: current.tagName.toLowerCase(),
        id: current.id,
        index,
        classes,
        other,
        innerText: html.innerText ?? '',
      });
      const node: Element = current;
      current = node.parentElement;
      if (current === null) {
        const root = node.getRootNode() as ShadowRoot;
        if (root && 'host' in root && root.host) {
          current = root.host;
        }
      }
    }
    return items;
  });
}

export interface NeighborSignatureWire {
  tag: string;
  id: string;
  classes: string[];
  text: string;
}

/** Identity of the located element itself, as the adaptive decision expects it. */
export interface ElementIdentityWire extends NeighborSignatureWire {
  attributes: Record<string, string>;
  hidden: boolean;
}

export interface NeighborContextWire {
  index: number;
  siblingCount: number;
  prev: NeighborSignatureWire | null;
  next: NeighborSignatureWire | null;
  /** Phase-21 identity guard: what the located element was when the action succeeded. */
  self?: ElementIdentityWire;
}

/**
 * Phase-16 adaptive mode: capture the element's relational position (index among element
 * siblings, sibling count, previous/next sibling identity) on the last successful action.
 * Phase-21 adds the element's own identity so a later action can notice that the locator now
 * resolves to a different element. Kept in-process only — the backend path format is unchanged.
 *
 * The identity block is written out here instead of calling a shared helper on purpose:
 * Playwright ships the function SOURCE into the page, so any module-scope reference (such as a
 * helper) is undefined there and the whole capture throws.
 */
export function captureNeighborContext(element: Element): NeighborContextWire {
  let index = 0;
  let sibling = element.previousElementSibling;
  while (sibling !== null) {
    index++;
    sibling = sibling.previousElementSibling;
  }
  const signature = (target: Element | null): NeighborContextWire['prev'] => {
    if (target === null) {
      return null;
    }
    const classAttribute = target.getAttribute('class');
    return {
      tag: target.tagName.toLowerCase(),
      id: target.id,
      classes: classAttribute !== null ? classAttribute.split(' ') : [],
      text: (target as HTMLElement).innerText ?? '',
    };
  };
  const classAttribute = element.getAttribute('class');
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (attr.name !== 'id' && attr.name !== 'class') {
      attributes[attr.name] = attr.value;
    }
  }
  const check = (element as Element & { checkVisibility?: () => boolean }).checkVisibility;
  const parent = element.parentElement;
  return {
    index,
    siblingCount: parent !== null ? parent.children.length : 1,
    prev: signature(element.previousElementSibling),
    next: signature(element.nextElementSibling),
    self: {
      tag: element.tagName.toLowerCase(),
      id: element.id,
      classes: classAttribute !== null ? classAttribute.split(' ') : [],
      text: (element as HTMLElement).innerText ?? '',
      attributes,
      hidden:
        typeof check === 'function'
          ? !check.call(element)
          : element.closest('[hidden],[aria-hidden="true"],[inert]') !== null,
    },
  };
}

/**
 * Phase-21 identity guard: identity of a currently resolved element (runs in the page). Same
 * inlining constraint as captureNeighborContext above.
 */
export function captureElementIdentity(element: Element): ElementIdentityWire {
  const classAttribute = element.getAttribute('class');
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (attr.name !== 'id' && attr.name !== 'class') {
      attributes[attr.name] = attr.value;
    }
  }
  const check = (element as Element & { checkVisibility?: () => boolean }).checkVisibility;
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id,
    classes: classAttribute !== null ? classAttribute.split(' ') : [],
    text: (element as HTMLElement).innerText ?? '',
    attributes,
    hidden:
      typeof check === 'function'
        ? !check.call(element)
        : element.closest('[hidden],[aria-hidden="true"],[inert]') !== null,
  };
}

/** Convert captured wire items to Node paths. Classes stay raw (Set of the split array). */
export function itemsToNodePaths(items: CapturedNode[][]): Node[][] {
  return items.map((path) =>
    path.map(
      (item) =>
        new Node(
          item.tag,
          item.id,
          new Set(item.classes),
          item.index,
          new Map(Object.entries(item.other)),
          item.innerText,
        ),
    ),
  );
}

/**
 * Browser-context candidate serializer (Phase-6 shadowHealing). Returns the document HTML with
 * open shadow roots inlined as their host's children, so parse5 parses shadow content as regular
 * traversable nodes. page.content({includeShadow:true}) instead emits <template shadowrootmode>,
 * whose content parse5 places in a separate fragment and never traverses. The recursive helper is
 * nested so the callback is self-contained for Playwright serialization; native cloneNode/outerHTML
 * handle escaping. A shadow host's light children are replaced by its shadow children; closed roots
 * and slots are out of scope.
 */
export function serializeWithShadow(): string {
  function clone(element: Element): Element {
    const out = element.cloneNode(false) as Element;
    const shadow = element.shadowRoot;
    const source: ParentNode = shadow !== null && shadow.mode === 'open' ? shadow : element;
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === 1) {
        out.appendChild(clone(child as Element));
      } else {
        out.appendChild(child.cloneNode(true));
      }
    }
    return out;
  }
  return clone(document.documentElement).outerHTML;
}