import type { Node } from '../model/node.js';
import { isBlank, javaTrim } from '../utils/java-string.js';

/**
 * CSS locator generation — port of healenium-web elementcreators (Apache-2.0) and
 * HealingService.selectorDetailLevels (HealingService.java:39-46,163-167).
 * Components are emitted in the SelectorComponent enum declaration order, because
 * Java builds each detail level as an EnumSet, whose stream iterates in natural
 * (declaration) order regardless of the EnumSet.of(...) argument order.
 */
export type SelectorComponent =
  | 'PATH'
  | 'PARENT'
  | 'TAG'
  | 'ID'
  | 'CLASS'
  | 'POSITION'
  | 'ATTRIBUTES';

const COMPONENT_ORDER: SelectorComponent[] = [
  'PATH',
  'PARENT',
  'TAG',
  'ID',
  'CLASS',
  'POSITION',
  'ATTRIBUTES',
];

/**
 * skippedAttributes.txt lines (ResourceReader collects every line; the license header
 * lines are also in the Java set but never match an attribute key). Matching is
 * case-sensitive against the raw key, so "onChange" never matches a lowercased DOM key.
 */
const SKIPPED_ATTRIBUTES = new Set([
  'style',
  'onChange',
  'onKeyPress',
  'onSubmit',
  'onReset',
  'onClick',
  'onclick',
  'onFocus',
  'onLoad',
  'media',
  'height',
  'width',
  'formenctype',
  'formnovalidate',
]);

const SAFE_HASH_ID = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

/** TagElementCreator.java:20-22. */
export function tagComponent(node: Node): string {
  return node.tag;
}

/** IdElementCreator.java:24-42. */
export function idComponent(node: Node): string {
  const trimmed = javaTrim(node.id);
  if (trimmed.length === 0) {
    return '';
  }
  if (SAFE_HASH_ID.test(trimmed)) {
    return `#${trimmed}`;
  }
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[id="${escaped}"]`;
}

/** ClassElementCreator.java:22-27 (Set iteration order is unspecified in Java). */
export function classComponent(node: Node): string {
  return [...node.classes].map((clazz) => `.${clazz}`).join('');
}

/** PositionElementCreator.java:22-30. */
export function positionComponent(node: Node): string {
  if (node.parent === null) {
    return '';
  }
  return `:nth-child(${node.index + 1})`;
}

/** AttributesElementCreator.java:27-35. Values are not quote-escaped (upstream behavior). */
export function attributesComponent(node: Node): string {
  const parts: string[] = [];
  for (const [key, value] of node.otherAttributes) {
    if (isBlank(key) || isBlank(value)) {
      continue;
    }
    if (SKIPPED_ATTRIBUTES.has(key)) {
      continue;
    }
    parts.push(`[${javaTrim(key)}='${javaTrim(value)}']`);
  }
  return parts.join('');
}

/** ParentElementCreator.java:26-36. */
export function parentComponent(node: Node): string {
  const parent = node.parent;
  if (parent === null) {
    return '';
  }
  return `${tagComponent(parent)}${idComponent(parent)}${classComponent(parent)} > `;
}

/** PathElementCreator.java:24-49. */
export function pathComponent(node: Node): string {
  const path: string[] = [];
  let current: Node | null = node;
  while (current !== null) {
    let item = current.tag;
    if (hasSimilarNeighbours(current)) {
      item += positionComponent(current);
    }
    path.unshift(item);
    current = current.parent;
  }
  return path.join(' > ');
}

function hasSimilarNeighbours(current: Node): boolean {
  const parent = current.parent;
  if (parent === null) {
    return false;
  }
  return parent.children.filter((child) => child.tag === current.tag).length > 1;
}

const COMPONENT_CREATORS: Record<SelectorComponent, (node: Node) => string> = {
  PATH: pathComponent,
  PARENT: parentComponent,
  TAG: tagComponent,
  ID: idComponent,
  CLASS: classComponent,
  POSITION: positionComponent,
  ATTRIBUTES: attributesComponent,
};

export function createComponent(node: Node, component: SelectorComponent): string {
  return COMPONENT_CREATORS[component](node);
}

/** HealingService.construct (HealingService.java:163-167): join components in enum order. */
export function constructCss(node: Node, detailLevel: ReadonlySet<SelectorComponent>): string {
  return COMPONENT_ORDER.filter((component) => detailLevel.has(component))
    .map((component) => createComponent(node, component))
    .join('');
}

/** HealingService.TEMP (HealingService.java:39-46), each level pre-sorted in enum order. */
export const SELECTOR_DETAIL_LEVELS: ReadonlyArray<ReadonlySet<SelectorComponent>> = [
  new Set<SelectorComponent>(['TAG', 'ID']),
  new Set<SelectorComponent>(['TAG', 'CLASS']),
  new Set<SelectorComponent>(['PARENT', 'TAG', 'ID', 'CLASS']),
  new Set<SelectorComponent>(['PARENT', 'TAG', 'CLASS', 'POSITION']),
  new Set<SelectorComponent>(['PARENT', 'TAG', 'ID', 'CLASS', 'ATTRIBUTES']),
  new Set<SelectorComponent>(['PATH']),
];