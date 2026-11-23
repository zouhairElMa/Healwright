import type { WireNode } from '../backend/wire.js';
import type { Node } from '../model/node.js';

/**
 * Target-node shape used by the imitator (port of selector-imitator/src/node.py).
 * Unlike the LCS Node, classes are an ORDERED list: split_classes compares lists
 * order-sensitively, so capture order must be preserved here.
 */
export interface ImitatorNode {
  tag: string;
  id: string;
  classes: string[];
  index: number | null;
  otherAttributes: Record<string, string>;
  innerText: string;
}

/** Python str.split() with no args: split on whitespace runs, dropping empties. */
export function splitClasses(value: string): string[] {
  const trimmed = value.trim();
  return trimmed === '' ? [] : trimmed.split(/\s+/);
}

export function imitatorNodeFromWire(wire: WireNode): ImitatorNode {
  return {
    tag: wire.tag,
    id: wire.id,
    classes: splitClasses(wire.classes),
    index: wire.index,
    otherAttributes: { ...wire.other },
    innerText: wire.innerText,
  };
}

export function imitatorNodeFromTree(node: Node): ImitatorNode {
  return {
    tag: node.tag,
    id: node.id,
    classes: [...node.classes],
    index: node.index,
    otherAttributes: Object.fromEntries(node.otherAttributes),
    innerText: node.innerText,
  };
}