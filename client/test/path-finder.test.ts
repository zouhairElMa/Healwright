import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Node } from '../src/model/node.js';
import {
  find,
  findNearest,
  findScoresToNodes,
  getSortedNodes,
} from '../src/lcs/path-finder.js';

const vectors = JSON.parse(
  readFileSync(new URL('./vectors/lcs-vectors.json', import.meta.url), 'utf8'),
) as {
  pathFinder: {
    pathLengthToCheck: number;
    candidates: { tag: string; id: string; score: number }[];
  };
};

function bare(tag: string, id: string, index = 0): Node {
  return new Node(tag, id, new Set(), index, new Map(), '');
}

// Same tree as scripts/LcsVectors.java: html > body > div#main > (input#user, input#other).
function buildTree(): { root: Node; refPath: Node[] } {
  const inUser = bare('input', 'user', 0);
  const inOther = bare('input', 'other', 1);
  const div = bare('div', 'main', 0);
  div.children = [inUser, inOther];
  inUser.parent = div;
  inOther.parent = div;
  const body = bare('body', '', 0);
  body.children = [div];
  div.parent = body;
  const root = bare('html', '', 0);
  root.children = [body];
  body.parent = root;
  const refPath = [bare('html', ''), bare('body', ''), bare('div', 'main'), bare('input', 'user')];
  return { root, refPath };
}

describe('PathFinder end-to-end (JVM parity)', () => {
  it('matches pathLengthToCheck and ranked candidates', () => {
    const { root, refPath } = buildTree();
    const { pathLengthToCheck, scores } = findScoresToNodes(refPath, root);
    expect(pathLengthToCheck).toBe(vectors.pathFinder.pathLengthToCheck);
    const sorted = getSortedNodes(scores, 10, -1);
    expect(sorted).toHaveLength(vectors.pathFinder.candidates.length);
    sorted.forEach((entry, i) => {
      const expected = vectors.pathFinder.candidates[i]!;
      expect(entry.node.tag).toBe(expected.tag);
      expect(entry.node.id).toBe(expected.id);
      expect(entry.score).toBeCloseTo(expected.score, 10);
    });
  });

  it('findNearest returns the exact match', () => {
    const { root, refPath } = buildTree();
    const nearest = findNearest(refPath, root);
    expect(nearest?.tag).toBe('input');
    expect(nearest?.id).toBe('user');
  });

  it('find returns the top N guesses', () => {
    const { root, refPath } = buildTree();
    expect(find(refPath, root, 1)).toHaveLength(1);
    expect(find(refPath, root, 2)).toHaveLength(2);
  });
});

describe('getSortedNodes parameter normalization (PathFinder.java:141-161)', () => {
  const a = bare('input', 'a');
  const b = bare('input', 'b');
  const scores = new Map<number, Node[]>([
    [0.9, [a]],
    [0.4, [b]],
  ]);

  it('sorts by score descending', () => {
    expect(getSortedNodes(scores, 10, -1).map((s) => s.score)).toEqual([0.9, 0.4]);
  });

  it('applies the score cap inclusively', () => {
    expect(getSortedNodes(scores, 10, 0.5).map((s) => s.node.id)).toEqual(['a']);
    expect(getSortedNodes(scores, 10, 0.9).map((s) => s.node.id)).toEqual(['a']);
  });

  it('ignores a cap greater than 1 (normalizeScoreCap => -1)', () => {
    expect(getSortedNodes(scores, 10, 5)).toHaveLength(2);
  });

  it('resets a negative limit to 1 (normalizeLimit)', () => {
    expect(getSortedNodes(scores, -3, -1)).toHaveLength(1);
  });

  it('returns empty for a zero limit (Java stream limit(0))', () => {
    expect(getSortedNodes(scores, 0, -1)).toHaveLength(0);
  });
});