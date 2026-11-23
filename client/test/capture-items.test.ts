import { describe, it, expect } from 'vitest';
import { itemsToNodePaths } from '../src/playwright/capture.js';
import type { CapturedNode } from '../src/playwright/capture.js';

function item(overrides: Partial<CapturedNode> = {}): CapturedNode {
  return {
    tag: 'button',
    id: 'submit',
    index: 0,
    classes: ['primary'],
    other: { type: 'submit' },
    innerText: 'Submit',
    ...overrides,
  };
}

describe('itemsToNodePaths', () => {
  it('converts a single path preserving every field', () => {
    const paths = itemsToNodePaths([[item()]]);
    expect(paths).toHaveLength(1);
    const node = paths[0]![0]!;
    expect(node.tag).toBe('button');
    expect(node.id).toBe('submit');
    expect(node.index).toBe(0);
    expect([...node.classes]).toEqual(['primary']);
    expect([...node.otherAttributes]).toEqual([['type', 'submit']]);
    expect(node.innerText).toBe('Submit');
  });

  it('preserves raw class tokens including empties (reference/candidate asymmetry)', () => {
    // The browser capture splits the class attribute on ' ' without trimming/filtering,
    // so tokens like '' survive into the reference Set (NodeBuilder.setClasses:87-88).
    const paths = itemsToNodePaths([[item({ classes: ['a', '', 'b', 'a'] })]]);
    const classes = paths[0]![0]!.classes;
    expect(classes.has('')).toBe(true);
    expect(classes.has('a')).toBe(true);
    expect(classes.has('b')).toBe(true);
    expect(classes.size).toBe(3); // Set dedups the repeated 'a'
  });

  it('keeps multiple paths and multiple nodes per path in order', () => {
    const paths = itemsToNodePaths([
      [item({ tag: 'html', id: '', classes: [], other: {}, innerText: '' }), item()],
      [item({ tag: 'div', id: 'main', index: 2 })],
    ]);
    expect(paths).toHaveLength(2);
    expect(paths[0]!.map((n) => n.tag)).toEqual(['html', 'button']);
    expect(paths[1]![0]!.id).toBe('main');
    expect(paths[1]![0]!.index).toBe(2);
  });

  it('produces an empty array for no items', () => {
    expect(itemsToNodePaths([])).toEqual([]);
  });

  it('maps an empty other record to an empty Map', () => {
    const paths = itemsToNodePaths([[item({ other: {} })]]);
    expect(paths[0]![0]!.otherAttributes.size).toBe(0);
  });
});