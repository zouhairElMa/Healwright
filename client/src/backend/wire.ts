import { Node } from '../model/node.js';

/**
 * Wire shape emitted by NodeSerializer / read by NodeDeserializer (healenium-web).
 * `classes` is a single space-joined string on the wire (NodeSerializer.java:46, phase-1 §3).
 */
export interface WireNode {
  tag: string;
  index: number;
  innerText: string;
  id: string;
  classes: string;
  other: Record<string, string>;
}

/** NodeSerializer parity. Class order is not semantic (consumed back into a Set). */
export function nodeToWire(node: Node): WireNode {
  return {
    tag: node.tag,
    index: node.index,
    innerText: node.innerText,
    id: node.id,
    classes: [...node.classes].join(' '),
    other: Object.fromEntries(node.otherAttributes),
  };
}

/** NodeDeserializer + NodeBuilder.setAttributes parity: split/trim/filter classes, other excludes id/class/empty keys. */
export function nodeFromWire(wire: WireNode): Node {
  const classes = new Set(
    wire.classes
      .split(' ')
      .map((c) => c.trim())
      .filter((c) => c.length > 0),
  );
  const other = new Map<string, string>(
    Object.entries(wire.other).filter(
      ([k]) => k !== 'id' && k !== 'class' && k.trim().length > 0,
    ),
  );
  return new Node(wire.tag, wire.id, classes, wire.index, other, wire.innerText);
}