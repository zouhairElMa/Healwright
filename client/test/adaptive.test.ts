import { describe, expect, it } from 'vitest';
import { parseTree } from '../src/capture/parse-tree.js';
import { anchorNodes, decideAdaptive, identityDrift } from '../src/lcs/adaptive.js';
import type { ReferenceSnapshot } from '../src/lcs/adaptive.js';
import type { ScoredNode } from '../src/lcs/path-finder.js';
import type { Node } from '../src/model/node.js';

function walk(node: Node, out: Node[] = []): Node[] {
  out.push(node);
  for (const child of node.children) {
    walk(child, out);
  }
  return out;
}

function tree(html: string): Node {
  const root = parseTree(`<!doctype html><html><body>${html}</body></html>`);
  if (root === null) {
    throw new Error('parse failed');
  }
  return root;
}

function byId(root: Node, id: string): Node {
  const found = walk(root).find((node) => node.id === id);
  if (found === undefined) {
    throw new Error(`missing #${id}`);
  }
  return found;
}

function poolOf(root: Node, tag: string): ScoredNode[] {
  return walk(root)
    .filter((node) => node.tag === tag)
    .map((node, index) => ({ node, score: 0.9 - index * 0.01 }));
}

function signature(node: Node | undefined): ReferenceSnapshot['prev'] {
  if (node === undefined) {
    return null;
  }
  return { tag: node.tag, id: node.id, classes: [...node.classes], text: node.innerText };
}

function snapshotOf(node: Node): ReferenceSnapshot {
  const parent = node.parent;
  if (parent === null) {
    throw new Error('reference has no parent');
  }
  const at = parent.children.indexOf(node);
  return {
    index: at,
    siblingCount: parent.children.length,
    prev: signature(at > 0 ? parent.children[at - 1] : undefined),
    next: signature(at >= 0 ? parent.children[at + 1] : undefined),
  };
}

const BUTTONS = '<div id="root"><button id="row_1">Delete</button><button id="row_2">Delete</button><button id="row_3">Delete</button></div>';

describe('adaptive decision', () => {
  it('look-alikes, middle renamed: neighbour context restores the original', () => {
    const before = tree(BUTTONS);
    const reference = byId(before, 'row_2');
    const snapshot = snapshotOf(reference);

    const after = tree(BUTTONS);
    byId(after, 'row_2').id = 'row_two_2b3wd';

    const decision = decideAdaptive(reference, poolOf(after, 'button'), snapshot);
    expect(decision.reason).toBe('adaptive-heal');
    expect(decision.winner?.node.id).toBe('row_two_2b3wd');
    expect(decision.candidates[0]?.context).toBe(2);
  });

  it('look-alikes, copy inserted before: absolute index would pick row_1, context picks the original', () => {
    const before = tree(BUTTONS);
    const reference = byId(before, 'row_2');
    const snapshot = snapshotOf(reference);

    const after = tree(
      '<div id="root"><button id="row_b_2b3wd">Delete</button><button id="row_1">Delete</button>' +
        '<button id="row_two_2b3wd">Delete</button><button id="row_3">Delete</button></div>',
    );
    const decision = decideAdaptive(reference, poolOf(after, 'button'), snapshot);
    expect(decision.reason).toBe('adaptive-heal');
    expect(decision.winner?.node.id).toBe('row_two_2b3wd');
    expect(decision.winner?.node.index).toBe(2);
  });

  it('qty, original renamed and copy inserted: the preserved placeholder identifies the original', () => {
    const before = tree('<div id="root"><input class="qty" id="qty_a" placeholder="Quantity"></div>');
    const reference = byId(before, 'qty_a');
    const snapshot = snapshotOf(reference);

    const after = tree(
      '<div id="root"><input class="qty" id="qty_b_2b3wd" placeholder="Quantity (copy)">' +
        '<input class="qty" id="qty_a_2b3wd" placeholder="Quantity"></div>',
    );
    const decision = decideAdaptive(reference, poolOf(after, 'input'), snapshot);
    expect(decision.reason).toBe('adaptive-heal');
    expect(decision.winner?.node.id).toBe('qty_a_2b3wd');
    expect(decision.candidates[0]?.signals).toContain('attr:placeholder');
  });

  it('deleted element: a similar neighbour is refused', () => {
    const before = tree('<div id="root"><button id="obsolete">Archive</button><button id="cancel_btn">Cancel</button></div>');
    const reference = byId(before, 'obsolete');
    const snapshot = snapshotOf(reference);

    const after = tree('<div id="root"><button id="cancel_9x">Cancel 9x</button></div>');
    const decision = decideAdaptive(reference, poolOf(after, 'button'), snapshot);
    expect(decision.winner).toBeNull();
    expect(decision.reason).toBe('adaptive-no-evidence');
  });

  it('strict clones without context: ambiguous, refused', () => {
    const before = tree('<div id="root"><button id="a_x">Delete</button></div>');
    const reference = byId(before, 'a_x');

    const after = tree('<div id="root"><button id="b_x">Delete</button><button id="c_x">Delete</button></div>');
    const decision = decideAdaptive(reference, poolOf(after, 'button'), null);
    expect(decision.winner).toBeNull();
    expect(decision.reason).toBe('adaptive-ambiguous');
  });

  it('position alone never heals, even when index and sibling count match', () => {
    const before = tree(
      '<div id="root"><button id="a">A</button><button id="t">T</button><button id="b">B</button></div>',
    );
    const reference = byId(before, 't');
    const snapshot = snapshotOf(reference);

    const after = tree(
      '<div id="root"><button id="x">Z</button><button id="t2">Z</button><button id="y">Z</button></div>',
    );
    const decision = decideAdaptive(reference, poolOf(after, 'button'), snapshot);
    expect(decision.winner).toBeNull();
    expect(decision.reason).toBe('adaptive-no-evidence');
    const middle = decision.candidates.find((candidate) => candidate.node.id === 't2');
    expect(middle?.position).toBe(true);
  });

  it('exact id is a preserved signal even without context', () => {
    const before = tree('<div id="root"><span id="status" class="ok">Ready</span></div>');
    const reference = byId(before, 'status');

    const after = tree('<div id="root"><strong id="status" class="ok">Ready</strong></div>');
    const decision = decideAdaptive(reference, poolOf(after, 'strong'), null);
    expect(decision.reason).toBe('adaptive-heal');
    expect(decision.winner?.node.tag).toBe('strong');
    expect(decision.candidates[0]?.signals).toContain('id');
  });

  it('a single document-unique neighbour counts as full context (contextFull)', () => {
    const before = tree(
      '<form id="root"><span id="label_save">Save draft</span><button id="go">Go</button></form>',
    );
    const reference = byId(before, 'go');
    const snapshot = snapshotOf(reference);

    // The button was renamed and the form now has a sibling after it, but its label survived
    // exactly and that label is unique in the document.
    const after = tree(
      '<form id="root"><span id="label_save">Save draft</span><button id="renamed">Go</button><i>x</i></form>',
    );
    const decision = decideAdaptive(reference, poolOf(after, 'button'), snapshot, { root: after });
    expect(decision.reason).toBe('adaptive-heal');
    expect(decision.winner?.node.id).toBe('renamed');
    expect(decision.candidates[0]?.contextFull).toBe(true);
  });

  it('a neighbour repeated in the document is not full context', () => {
    const before = tree(
      '<div id="root"><span>Edit</span><button id="a">Go</button></div>' +
        '<div id="other"><span>Edit</span><button id="b">Go</button></div>',
    );
    const reference = byId(before, 'a');
    const snapshot = snapshotOf(reference);

    const after = tree(
      '<div id="root"><span>Edit</span><button id="x">Go</button></div>' +
        '<div id="other"><span>Edit</span><button id="y">Go</button></div>',
    );
    const decision = decideAdaptive(reference, poolOf(after, 'button'), snapshot, { root: after });
    expect(decision.candidates.every((candidate) => candidate.contextFull === false)).toBe(true);
  });

  it('volatile attributes are not signals', () => {
    const before = tree('<div id="root"><button id="a" aria-pressed="false">T</button></div>');
    const reference = byId(before, 'a');
    const after = tree('<div id="root"><button id="a" aria-pressed="true">T</button></div>');
    const decision = decideAdaptive(reference, poolOf(after, 'button'), null);
    expect(decision.candidates[0]?.signals).not.toContain('attr:aria-pressed');
  });

  it('hidden look-alikes are dropped when the reference was visible', () => {
    const before = tree('<div id="root"><button id="a">T</button></div>');
    const reference = byId(before, 'a');
    const after = tree(
      '<div id="root"><button id="a">T</button><button id="ghost" hidden="">T</button></div>',
    );
    const decision = decideAdaptive(reference, poolOf(after, 'button'), null);
    expect(decision.candidates.map((candidate) => candidate.node.id)).toEqual(['a']);
  });
});

describe('anchor nodes (phase-21 recall)', () => {
  const anchored = (root: Node, value: string): Node => {
    const found = walk(root).find((node) => node.otherAttributes.get('data-bench-id') === value);
    if (found === undefined) {
      throw new Error(`missing data-bench-id=${value}`);
    }
    return found;
  };

  it('pulls a node whose testid survived, even when the tag and classes changed', () => {
    const before = tree(
      '<div id="root"><button class="old" data-bench-id="l5_01">Pay</button></div>',
    );
    const reference = anchored(before, 'l5_01');
    const after = tree(
      '<div id="root"><div role="button" class="copy">Pay</div>' +
        '<span data-bench-id="l5_01" class="totally-new">Pay</span></div>',
    );
    const anchors = anchorNodes(reference, after);
    expect(anchors.map((node) => node.tag)).toEqual(['span']);
  });

  it('ignores a value worn by several nodes (a group, not an identity)', () => {
    const before = tree('<div id="root"><button data-x="v">A</button></div>');
    const reference = walk(before).find((node) => node.tag === 'button')!;
    const after = tree('<div id="root"><button data-x="v">A</button><button data-x="v">B</button></div>');
    expect(anchorNodes(reference, after)).toEqual([]);
  });

  it('collects the node itself once even when several anchors match it', () => {
    const before = tree('<div id="root"><button id="hit" data-x="v" name="n">A</button></div>');
    const reference = byId(before, 'hit');
    const after = tree('<div id="root"><button id="hit" data-x="v" name="n">A</button></div>');
    expect(anchorNodes(reference, after)).toHaveLength(1);
  });
});

describe('identity drift (phase-21 decoy guard)', () => {
  const identity = (overrides: Record<string, unknown> = {}) => ({
    tag: 'button',
    id: '',
    classes: ['btn', 'primary'],
    attributes: { 'data-bench-id': 'k', type: 'button' },
    text: 'Pay',
    hidden: false,
    ...overrides,
  });

  it('a decoy wearing another class set drifts', () => {
    expect(identityDrift(identity(), identity({ classes: ['btn'] }))).toBe(true);
  });

  it('a lost id or anchor attribute drifts', () => {
    expect(identityDrift(identity(), identity({ attributes: { type: 'button' } }))).toBe(true);
    expect(identityDrift(identity(), identity({ id: 'moved' }))).toBe(true);
  });

  it('text and volatile state do not drift', () => {
    expect(identityDrift(identity(), identity({ text: 'Pay now' }))).toBe(false);
    expect(
      identityDrift(
        identity({ attributes: { 'aria-pressed': 'false' } }),
        identity({ attributes: { 'aria-pressed': 'true' } }),
      ),
    ).toBe(false);
  });
});
