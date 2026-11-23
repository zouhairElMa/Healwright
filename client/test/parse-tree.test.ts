import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Node } from '../src/model/node.js';
import { parseTree } from '../src/capture/parse-tree.js';

interface VectorNode {
  tag: string;
  id: string;
  classes: string;
  index: number;
  innerText: string;
  other: Record<string, string>;
  children: VectorNode[];
}
const vectors = JSON.parse(
  readFileSync(new URL('./vectors/parse-vectors.json', import.meta.url), 'utf8'),
) as Record<string, { html: string; tree: VectorNode }>;

function normalize(node: Node): VectorNode {
  return {
    tag: node.tag,
    id: node.id,
    classes: [...node.classes].sort().join(' '),
    index: node.index,
    innerText: node.innerText,
    other: Object.fromEntries(node.otherAttributes),
    children: node.children.map(normalize),
  };
}

describe('parseTree vs real JsoupHTMLParser (parse vectors)', () => {
  it.each(Object.entries(vectors))('%s', (_name, { html, tree }) => {
    const root = parseTree(html);
    expect(root).not.toBeNull();
    expect(normalize(root!)).toEqual(tree);
  });

  it('wires parent and children consistently', () => {
    const root = parseTree('<html><body><div id="x"><input id="u"></div></body></html>')!;
    expect(root.parent).toBeNull();
    const body = root.children.find((c) => c.tag === 'body')!;
    expect(body.parent).toBe(root);
    const div = body.children[0]!;
    expect(div.parent).toBe(body);
    const input = div.children[0]!;
    expect(input.parent).toBe(div);
    expect(input.children).toEqual([]);
  });

  it('counts index among element siblings only, ignoring text nodes', () => {
    const root = parseTree('<html><body>text<p id="a"></p>more<p id="b"></p></body></html>')!;
    const body = root.children.find((c) => c.tag === 'body')!;
    expect(body.children.map((c) => [c.id, c.index])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});