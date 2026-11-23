import { describe, it, expect } from 'vitest';
import { Node } from '../src/model/node.js';

function n(tag: string, id: string): Node {
  return new Node(tag, id, new Set(), 0, new Map(), '');
}

describe('Node.equals — tag + id only, case-sensitive (Node.java:68-75)', () => {
  it('equal when tag and id match', () => {
    expect(n('div', 'a').equals(n('div', 'a'))).toBe(true);
  });

  it('ignores classes, index, attributes and text', () => {
    const a = new Node('div', 'a', new Set(['x']), 1, new Map([['k', 'v']]), 'text');
    const b = new Node('div', 'a', new Set(['y']), 9, new Map(), 'other');
    expect(a.equals(b)).toBe(true);
  });

  it('different id → not equal', () => {
    expect(n('div', 'a').equals(n('div', 'b'))).toBe(false);
  });

  it('tag comparison is case-sensitive', () => {
    expect(n('DIV', 'a').equals(n('div', 'a'))).toBe(false);
  });

  it('id comparison is case-sensitive', () => {
    expect(n('div', 'A').equals(n('div', 'a'))).toBe(false);
  });
});