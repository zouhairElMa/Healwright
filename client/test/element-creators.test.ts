import { describe, expect, it } from 'vitest';
import { Node } from '../src/model/node.js';
import {
  SELECTOR_DETAIL_LEVELS,
  attributesComponent,
  classComponent,
  constructCss,
  idComponent,
  parentComponent,
  pathComponent,
  positionComponent,
  tagComponent,
} from '../src/selector/element-creators.js';

function makeNode(
  tag: string,
  id = '',
  classes: string[] = [],
  index = 0,
  other: Record<string, string> = {},
): Node {
  return new Node(tag, id, new Set(classes), index, new Map(Object.entries(other)), '');
}

function wire(parent: Node, children: Node[]): void {
  parent.children = children;
  children.forEach((child, i) => {
    child.parent = parent;
    child.index = i;
  });
}

describe('idComponent (IdElementCreator.java:24-42)', () => {
  it('uses # for hash-safe ids', () => {
    expect(idComponent(makeNode('input', 'user'))).toBe('#user');
    expect(idComponent(makeNode('input', '_x'))).toBe('#_x');
    expect(idComponent(makeNode('input', '-foo'))).toBe('#-foo');
    expect(idComponent(makeNode('input', 'a-b_1'))).toBe('#a-b_1');
  });

  it('returns empty for blank/whitespace ids (trimToNull)', () => {
    expect(idComponent(makeNode('input', ''))).toBe('');
    expect(idComponent(makeNode('input', '   '))).toBe('');
  });

  it('falls back to [id="..."] with escaping for unsafe ids', () => {
    expect(idComponent(makeNode('input', '123'))).toBe('[id="123"]');
    expect(idComponent(makeNode('input', 'a:b'))).toBe('[id="a:b"]');
    expect(idComponent(makeNode('input', 'a"b'))).toBe('[id="a\\"b"]');
    expect(idComponent(makeNode('input', 'a\\b'))).toBe('[id="a\\\\b"]');
  });
});

describe('attributesComponent (AttributesElementCreator.java:27-35)', () => {
  it('formats non-skipped attributes with single quotes, trimmed', () => {
    const node = makeNode('input', '', [], 0, { type: 'text', name: ' username ' });
    expect(attributesComponent(node)).toBe("[type='text'][name='username']");
  });

  it('skips listed attributes case-sensitively and blank values', () => {
    const node = makeNode('input', '', [], 0, {
      style: 'color:red',
      onclick: 'x()',
      onChange: 'y()',
      onchange: 'z()',
      height: '10',
      empty: '   ',
      name: 'ok',
    });
    // onchange is NOT in the skip list (only onChange), so it survives.
    expect(attributesComponent(node)).toBe("[onchange='z()'][name='ok']");
  });
});

describe('positionComponent / parentComponent', () => {
  it('position is nth-child(index+1) only with a parent', () => {
    const parent = makeNode('div', 'main');
    const child = makeNode('input', 'user');
    wire(parent, [makeNode('span'), child]);
    expect(positionComponent(child)).toBe(':nth-child(2)');
    expect(positionComponent(parent)).toBe('');
  });

  it('parent combines parent tag+id+class then " > "', () => {
    const parent = makeNode('div', 'main', ['container']);
    const child = makeNode('input', 'user');
    wire(parent, [child]);
    expect(parentComponent(child)).toBe('div#main.container > ');
    expect(parentComponent(parent)).toBe('');
  });
});

describe('pathComponent (PathElementCreator.java:24-49)', () => {
  it('adds nth-child only for tags with similar neighbours', () => {
    const html = makeNode('html');
    const body = makeNode('body');
    const div = makeNode('div', 'main');
    const user = makeNode('input', 'user');
    const other = makeNode('input', 'other');
    wire(html, [body]);
    wire(body, [div]);
    wire(div, [user, other]);
    expect(pathComponent(user)).toBe('html > body > div > input:nth-child(1)');
    expect(pathComponent(other)).toBe('html > body > div > input:nth-child(2)');
    expect(pathComponent(div)).toBe('html > body > div');
  });
});

describe('constructCss detail levels (HealingService.java:39-46,163-167)', () => {
  const html = makeNode('html');
  const body = makeNode('body');
  const div = makeNode('div', 'main', ['container']);
  const span = makeNode('span');
  const input = makeNode('input', 'user', ['form', 'ctrl'], 0, {
    type: 'text',
    name: 'username',
  });
  wire(html, [body]);
  wire(body, [div]);
  wire(div, [span, input]);

  const expected = [
    'input#user',
    'input.form.ctrl',
    'div#main.container > input#user.form.ctrl',
    'div#main.container > input.form.ctrl:nth-child(2)',
    "div#main.container > input#user.form.ctrl[type='text'][name='username']",
    'html > body > div > input',
  ];

  it('produces the six Healenium detail levels in order', () => {
    expect(SELECTOR_DETAIL_LEVELS).toHaveLength(6);
    SELECTOR_DETAIL_LEVELS.forEach((level, i) => {
      expect(constructCss(input, level)).toBe(expected[i]);
    });
  });

  it('emits components in enum declaration order regardless of set insertion', () => {
    const level = new Set(['ID', 'TAG'] as const);
    expect(constructCss(input, level)).toBe('input#user');
  });
});

describe('basic components', () => {
  it('tag and class render literally', () => {
    const node = makeNode('input', 'user', ['form', 'ctrl']);
    expect(tagComponent(node)).toBe('input');
    expect(classComponent(node)).toBe('.form.ctrl');
  });
});