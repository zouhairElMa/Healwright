import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Node } from '../src/model/node.js';
import { heuristicNodeDistance } from '../src/lcs/node-distance.js';

interface NodeDistanceVector {
  target: string;
  d: number;
  h: number;
  score: number;
}
const vectors = JSON.parse(
  readFileSync(new URL('./vectors/lcs-vectors.json', import.meta.url), 'utf8'),
) as { nodeDistance: NodeDistanceVector[] };

function makeNode(
  tag: string,
  id: string,
  classes: string[],
  index: number,
  other: Record<string, string>,
  innerText: string,
): Node {
  return new Node(tag, id, new Set(classes), index, new Map(Object.entries(other)), innerText);
}

// Same operands as scripts/LcsVectors.java (generated from the real tree-comparing jar).
const ref = makeNode('input', 'user', ['form', 'ctrl'], 2, { type: 'text', name: 'username' }, 'Hello');
const targets: Record<string, Node> = {
  identical: makeNode('input', 'user', ['form', 'ctrl'], 2, { type: 'text', name: 'username' }, 'Hello'),
  idChanged: makeNode('input', 'username', ['form', 'ctrl2'], 2, { type: 'text', name: 'username' }, 'Hello world'),
  tagChanged: makeNode('button', 'user', ['form', 'ctrl'], 2, { type: 'text', name: 'username' }, 'Hello'),
  empty: makeNode('', '', [], 0, {}, ''),
};

describe('heuristicNodeDistance (JVM parity)', () => {
  it.each(vectors.nodeDistance)('$target d=$d h=$h => $score', ({ target, d, h, score }) => {
    expect(heuristicNodeDistance(ref, targets[target]!, d, h)).toBeCloseTo(score, 10);
  });

  it('returns 0 when curPathHeight is 0', () => {
    expect(heuristicNodeDistance(ref, targets['identical']!, 4, 0)).toBe(0);
  });

  it('returns 0 when height > 5 and LCS ratio < 0.7', () => {
    expect(heuristicNodeDistance(ref, targets['identical']!, 4, 6)).toBe(0);
  });

  it('scores a perfect match as 1', () => {
    expect(heuristicNodeDistance(ref, targets['identical']!, 4, 4)).toBe(1);
  });
});