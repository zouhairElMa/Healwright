/**
 * Clean-room port of healenium-selector-imitator/src/selector.py (no upstream license).
 * The eight Selenium By types are preserved exactly; healing never changes the type.
 */
import { cssSelectorString, xpathSelectorString } from './constructor.js';
import { parseCssSelector, parseXPathSelector } from './parser.js';

export const SelectorType = {
  BY_CLASS_NAME: 'By.className',
  BY_CSS_SELECTOR: 'By.cssSelector',
  BY_ID: 'By.id',
  BY_LINK_TEXT: 'By.linkText',
  BY_NAME: 'By.name',
  BY_PARTIAL_LINK_TEXT: 'By.partialLinkText',
  BY_TAG_NAME: 'By.tagName',
  BY_XPATH: 'By.xpath',
} as const;

export type SelectorType = (typeof SelectorType)[keyof typeof SelectorType];

export interface Selector {
  selectorType: SelectorType;
  tag: string | null;
  id: string | null;
  classes: string[] | null;
  index: number | null;
  otherAttributes: Record<string, string> | null;
  innerText: string | null;
  splitClasses: boolean;
}

export function emptySelector(selectorType: SelectorType): Selector {
  return {
    selectorType,
    tag: null,
    id: null,
    classes: null,
    index: null,
    otherAttributes: null,
    innerText: null,
    splitClasses: false,
  };
}

export function selectorFromTypeAndValue(selectorType: SelectorType, value: string): Selector {
  const selector = emptySelector(selectorType);
  switch (selectorType) {
    case SelectorType.BY_CLASS_NAME:
      selector.classes = [value];
      return selector;
    case SelectorType.BY_CSS_SELECTOR: {
      const parsed = parseCssSelector(value);
      selector.tag = parsed.tag === '' ? null : parsed.tag;
      selector.id = parsed.id === '' ? null : parsed.id;
      selector.classes = parsed.classes.length === 0 ? null : parsed.classes;
      selector.otherAttributes =
        Object.keys(parsed.attributes).length === 0 ? null : parsed.attributes;
      return selector;
    }
    case SelectorType.BY_ID:
      selector.id = value;
      return selector;
    case SelectorType.BY_LINK_TEXT:
    case SelectorType.BY_PARTIAL_LINK_TEXT:
      selector.innerText = value;
      return selector;
    case SelectorType.BY_NAME:
      selector.otherAttributes = { name: value };
      return selector;
    case SelectorType.BY_TAG_NAME:
      selector.tag = value;
      return selector;
    case SelectorType.BY_XPATH: {
      const parsed = parseXPathSelector(value);
      selector.tag = parsed.tag === '' ? null : parsed.tag;
      selector.id = parsed.id === '' ? null : parsed.id;
      selector.classes = parsed.classes.length === 0 ? null : parsed.classes;
      selector.index = parsed.index;
      selector.otherAttributes =
        Object.keys(parsed.attributes).length === 0 ? null : parsed.attributes;
      selector.innerText = parsed.innerText === '' ? null : parsed.innerText;
      return selector;
    }
    default:
      throw new Error(`Invalid selector type: ${String(selectorType)}`);
  }
}

export function selectorToString(selector: Selector): string {
  switch (selector.selectorType) {
    case SelectorType.BY_CLASS_NAME: {
      const classes = selector.classes;
      if (classes === null || classes.length === 0) {
        throw new Error('BY_CLASS_NAME selector must contain one class name, none provided.');
      }
      if (classes.length === 1) {
        return classes[0]!;
      }
      throw new Error(
        'Ambiguous BY_CLASS_NAME selector. Only one class allowed for this selector type.',
      );
    }
    case SelectorType.BY_CSS_SELECTOR:
      return cssSelectorString(selector);
    case SelectorType.BY_ID:
      return selector.id ?? '';
    case SelectorType.BY_LINK_TEXT:
    case SelectorType.BY_PARTIAL_LINK_TEXT:
      return selector.innerText ?? '';
    case SelectorType.BY_NAME:
      if (selector.otherAttributes !== null && 'name' in selector.otherAttributes) {
        return selector.otherAttributes['name']!;
      }
      throw new Error('BY_NAME selector must contain name attribute.');
    case SelectorType.BY_TAG_NAME:
      return selector.tag ?? '';
    case SelectorType.BY_XPATH:
      return xpathSelectorString(selector, selector.splitClasses);
    default:
      return '';
  }
}

/** Selector.__eq__: classes compared as sets, other fields by value. */
export function selectorsEqual(a: Selector, b: Selector): boolean {
  const setEqual = (x: string[] | null, y: string[] | null): boolean => {
    const xs = new Set(x ?? []);
    const ys = new Set(y ?? []);
    return xs.size === ys.size && [...xs].every((v) => ys.has(v));
  };
  const recordEqual = (
    x: Record<string, string> | null,
    y: Record<string, string> | null,
  ): boolean => {
    const xe = Object.entries(x ?? {});
    const ye = Object.entries(y ?? {});
    return (
      xe.length === ye.length &&
      xe.every(([k, v]) => Object.prototype.hasOwnProperty.call(y ?? {}, k) && y![k] === v)
    );
  };
  return (
    a.selectorType === b.selectorType &&
    a.tag === b.tag &&
    a.id === b.id &&
    setEqual(a.classes, b.classes) &&
    a.index === b.index &&
    recordEqual(a.otherAttributes, b.otherAttributes) &&
    a.innerText === b.innerText
  );
}