import { describe, it, expect } from 'vitest';
import { Node } from '../src/model/node.js';
import { nodeToWire, nodeFromWire } from '../src/backend/wire.js';

describe('nodeToWire — NodeSerializer parity', () => {
  it('emits classes as a space-joined string and other as a map', () => {
    const node = new Node(
      'div',
      'id1',
      new Set(['a', 'b']),
      3,
      new Map([['name', 'v']]),
      'text',
    );
    const wire = nodeToWire(node);
    expect(wire.tag).toBe('div');
    expect(wire.index).toBe(3);
    expect(wire.id).toBe('id1');
    expect(wire.innerText).toBe('text');
    expect(new Set(wire.classes.split(' '))).toEqual(new Set(['a', 'b']));
    expect(wire.other).toEqual({ name: 'v' });
  });
});

describe('nodeFromWire — NodeDeserializer + NodeBuilder parity', () => {
  it('splits, trims and filters empty classes', () => {
    const node = nodeFromWire({
      tag: 'div',
      index: 0,
      innerText: '',
      id: '',
      classes: ' a  b ',
      other: {},
    });
    expect(node.classes).toEqual(new Set(['a', 'b']));
  });

  it('excludes id/class and empty keys from other attributes', () => {
    const node = nodeFromWire({
      tag: 'div',
      index: 0,
      innerText: '',
      id: 'x',
      classes: 'c',
      other: { id: 'x', class: 'c', name: 'n', '': 'e' },
    });
    expect(node.otherAttributes).toEqual(new Map([['name', 'n']]));
  });

  it('round-trips a node through the wire format', () => {
    const node = new Node(
      'input',
      'user',
      new Set(['form', 'ctrl']),
      2,
      new Map([['type', 'text']]),
      'hello',
    );
    const back = nodeFromWire(nodeToWire(node));
    expect(back.tag).toBe(node.tag);
    expect(back.id).toBe(node.id);
    expect(back.classes).toEqual(node.classes);
    expect(back.index).toBe(node.index);
    expect(back.otherAttributes).toEqual(node.otherAttributes);
    expect(back.innerText).toBe(node.innerText);
    expect(back.equals(node)).toBe(true);
  });
});