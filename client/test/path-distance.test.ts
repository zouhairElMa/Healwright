import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Node } from '../src/model/node.js';
import { lcsPathDistance } from '../src/lcs/path-distance.js';

const vectors = JSON.parse(
  readFileSync(new URL('./vectors/lcs-vectors.json', import.meta.url), 'utf8'),
) as { lcs: { case: string; length: number }[] };

function bare(tag: string, id: string): Node {
  return new Node(tag, id, new Set(), 0, new Map(), '');
}

// Same paths as scripts/LcsVectors.java.
const html = bare('html', '');
const body = bare('body', '');
const divMain = bare('div', 'main');
const inputUser = bare('input', 'user');
const inputUsername = bare('input', 'username');
const sectionMain = bare('section', 'main');

const p1 = [html, body, divMain, inputUser];
const paths: Record<string, Node[]> = {
  identical: [html, body, divMain, inputUser],
  idChanged: [html, body, divMain, inputUsername],
  tagChanged: [html, body, sectionMain, inputUser],
};

describe('lcsPathDistance (JVM parity)', () => {
  it.each(vectors.lcs)('$case => $length', ({ case: name, length }) => {
    expect(lcsPathDistance(p1, paths[name]!)).toBe(length);
  });

  it('returns 0 for empty or disjoint paths', () => {
    expect(lcsPathDistance([], [])).toBe(0);
    expect(lcsPathDistance(p1, [])).toBe(0);
    expect(lcsPathDistance([bare('a', '1')], [bare('b', '2')])).toBe(0);
  });

  it('matches on tag + id only (case-sensitive)', () => {
    expect(lcsPathDistance([bare('input', 'user')], [bare('input', 'user')])).toBe(1);
    expect(lcsPathDistance([bare('input', 'user')], [bare('INPUT', 'user')])).toBe(0);
    expect(lcsPathDistance([bare('input', 'user')], [bare('input', 'User')])).toBe(0);
  });
});