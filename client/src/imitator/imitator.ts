/**
 * Clean-room port of healenium-selector-imitator/src/selector_imitator.py (no upstream license).
 * Given a user selector and a healed target node, produce selectors that imitate the user's
 * selector type/shape on the new node. The selector type is always preserved.
 */
import type { ImitatorNode } from './node.js';
import { SelectorType, emptySelector, type Selector } from './selector.js';

export class ImitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImitationError';
  }
}

export function imitate(userSelector: Selector, targetNode: ImitatorNode): Selector[] {
  switch (userSelector.selectorType) {
    case SelectorType.BY_CLASS_NAME:
      return imitateClassName(targetNode);
    case SelectorType.BY_CSS_SELECTOR:
    case SelectorType.BY_XPATH:
      return [imitateCssOrXpath(userSelector, targetNode)];
    case SelectorType.BY_ID:
      return [imitateId(targetNode)];
    case SelectorType.BY_LINK_TEXT:
    case SelectorType.BY_PARTIAL_LINK_TEXT:
      return [imitateLinkText(userSelector, targetNode)];
    case SelectorType.BY_NAME:
      return [imitateName(userSelector, targetNode)];
    case SelectorType.BY_TAG_NAME:
      return [imitateTagName(targetNode)];
    default:
      throw new ImitationError('Imitation for user selector type is not implemented.');
  }
}

function imitateClassName(node: ImitatorNode): Selector[] {
  if (node.classes.length > 0) {
    return node.classes.map((targetClass) => {
      const selector = emptySelector(SelectorType.BY_CLASS_NAME);
      selector.classes = [targetClass];
      return selector;
    });
  }
  throw new ImitationError('Target node does not belong to any class.');
}

function classesEqual(a: string[] | null, b: string[]): boolean {
  if (a === null || a.length !== b.length) {
    return false;
  }
  return a.every((value, i) => value === b[i]);
}

function imitateCssOrXpath(user: Selector, node: ImitatorNode): Selector {
  const target = emptySelector(user.selectorType);
  if (user.tag !== null) {
    if (node.tag !== '') {
      target.tag = node.tag;
    } else {
      throw new ImitationError('Target node does not have any tag.');
    }
  }
  if (user.id !== null) {
    if (node.id !== '') {
      target.id = node.id;
    } else {
      throw new ImitationError('Target node does not have any id.');
    }
  }
  if (user.classes !== null) {
    if (node.classes.length > 0) {
      target.classes = [];
      let someClassChanged = false;
      for (const cls of user.classes) {
        if (node.classes.includes(cls)) {
          target.classes.push(cls);
        } else {
          someClassChanged = true;
          break;
        }
      }
      if (someClassChanged) {
        target.classes = [...node.classes];
      }
    } else {
      throw new ImitationError('Target node does not belong to any classes.');
    }
  }
  // Upstream compares against the node list even when classes were absent (null != [] => true).
  target.splitClasses = !classesEqual(target.classes, node.classes);
  if (user.index !== null) {
    // Truthy check: index 0 is treated as absent (upstream quirk).
    if (node.index) {
      target.index = node.index;
    } else {
      throw new ImitationError('Target node does not have any index.');
    }
  }
  if (user.innerText !== null) {
    if (node.innerText !== '') {
      target.innerText = node.innerText;
    } else {
      throw new ImitationError('Target node does not have any inner text.');
    }
  }
  if (user.otherAttributes !== null) {
    target.otherAttributes = {};
    for (const attribute of Object.keys(user.otherAttributes)) {
      if (Object.prototype.hasOwnProperty.call(node.otherAttributes, attribute)) {
        target.otherAttributes[attribute] = node.otherAttributes[attribute]!;
      } else {
        throw new ImitationError(`Target node does not have an attribute ${attribute}.`);
      }
    }
  }
  return target;
}

function imitateId(node: ImitatorNode): Selector {
  if (node.id !== '') {
    const selector = emptySelector(SelectorType.BY_ID);
    selector.id = node.id;
    return selector;
  }
  throw new ImitationError('Target node does not have an id.');
}

function imitateLinkText(user: Selector, node: ImitatorNode): Selector {
  if (node.tag !== 'a') {
    throw new ImitationError(
      'Target node is not an anchor tag, so selector by link text is not applicable.',
    );
  }
  if (node.innerText !== '') {
    const selector = emptySelector(user.selectorType);
    selector.innerText = node.innerText;
    return selector;
  }
  throw new ImitationError('Target node does not have a link text.');
}

function imitateName(user: Selector, node: ImitatorNode): Selector {
  if (Object.prototype.hasOwnProperty.call(node.otherAttributes, 'name')) {
    if (user.otherAttributes !== null && 'name' in user.otherAttributes) {
      const selector = emptySelector(SelectorType.BY_NAME);
      selector.otherAttributes = { name: node.otherAttributes['name']! };
      return selector;
    }
    throw new ImitationError(
      'Invalid user selector: does not contain name attribute, while type is BY_NAME.',
    );
  }
  throw new ImitationError('Target node does not have a name attribute.');
}

function imitateTagName(node: ImitatorNode): Selector {
  if (node.tag !== '') {
    const selector = emptySelector(SelectorType.BY_TAG_NAME);
    selector.tag = node.tag;
    return selector;
  }
  throw new ImitationError('Target node does not have a tag name.');
}