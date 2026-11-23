import { describe, expect, it } from 'vitest';
import { Node } from '../src/model/node.js';
import { xpathCandidates, xpathLiteral } from '../src/selector/xpath-creators.js';

function node(opts: Partial<{ tag: string; id: string; classes: string[]; other: Record<string, string> }> = {}): Node {
  return new Node(
    opts.tag ?? 'input',
    opts.id ?? '',
    new Set(opts.classes ?? []),
    0,
    new Map(Object.entries(opts.other ?? {})),
    '',
  );
}

describe('xpathLiteral (XPath string escaping)', () => {
  it('uses single quotes when the value has none', () => {
    expect(xpathLiteral('newValue')).toBe("'newValue'");
  });
  it('switches to double quotes when the value contains a single quote', () => {
    expect(xpathLiteral("a'b")).toBe('"a\'b"');
  });
  it('uses concat() when the value contains both quote kinds', () => {
    expect(xpathLiteral('a\'b"c')).toBe('concat(\'a\', "\'", \'b"c\')');
  });
});

describe('xpathCandidates (phase-6 local XPath generation)', () => {
  it('prefers an id-based XPath', () => {
    expect(xpathCandidates(node({ id: 'newValue' }))).toContain("//input[@id='newValue']");
    expect(xpathCandidates(node({ id: 'newValue' }))[0]).toBe("//input[@id='newValue']");
  });

  it('emits class equality and contains() candidates', () => {
    const candidates = xpathCandidates(node({ classes: ['newClass'] }));
    expect(candidates).toContain("//input[@class='newClass']");
    expect(candidates).toContain("//input[contains(@class,'newClass')]");
  });

  it('emits attribute candidates for other attributes', () => {
    expect(xpathCandidates(node({ other: { name: 'return name' } }))).toContain(
      "//input[@name='return name']",
    );
  });

  it('skips volatile attributes (style, event handlers)', () => {
    const candidates = xpathCandidates(node({ other: { style: 'color:red', onclick: 'x()', name: 'n' } }));
    expect(candidates).toContain("//input[@name='n']");
    expect(candidates.some((c) => c.includes('@style'))).toBe(false);
    expect(candidates.some((c) => c.includes('@onclick'))).toBe(false);
  });

  it('uses * when the tag is empty', () => {
    expect(xpathCandidates(node({ tag: '', id: 'x' }))).toContain("//*[@id='x']");
  });

  it('returns no candidates for a node without id/class/attributes', () => {
    expect(xpathCandidates(node())).toEqual([]);
  });

  it('ignores blank ids and classes', () => {
    expect(xpathCandidates(node({ id: '   ', classes: [''] }))).toEqual([]);
  });
});