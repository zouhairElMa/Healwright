import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ParsingError,
  parseCssSelector,
  parseXPathSelector,
  removeQuotedText,
} from '../src/imitator/parser.js';
import {
  selectorFromTypeAndValue,
  selectorToString,
  type Selector,
  type SelectorType,
} from '../src/imitator/selector.js';
import { ImitationError, imitate } from '../src/imitator/imitator.js';
import { splitClasses, type ImitatorNode } from '../src/imitator/node.js';

interface SelectorFields {
  type: string;
  tag: string | null;
  id: string | null;
  classes: string[] | null;
  index: number | null;
  otherAttributes: Record<string, string> | null;
  innerText: string | null;
  splitClasses: boolean;
}
interface CssParserVector {
  selector: string;
  ok: boolean;
  tag?: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string>;
}
interface XPathParserVector extends CssParserVector {
  index?: number | null;
  innerText?: string;
}
interface FromStringVector {
  type: string;
  value: string;
  ok: boolean;
  fields?: SelectorFields;
  string?: string;
  error?: string;
}
interface ImitateResult extends SelectorFields {
  string?: string;
}
interface ImitateVector {
  type: string;
  userValue: string;
  target: {
    tag?: string;
    id?: string;
    classes?: string[];
    index?: number | null;
    other?: Record<string, string>;
    innerText?: string;
  };
  ok: boolean;
  results?: ImitateResult[];
  error?: string;
}
const vectors = JSON.parse(
  readFileSync(new URL('./vectors/imitator-vectors.json', import.meta.url), 'utf8'),
) as {
  cssParser: CssParserVector[];
  xpathParser: XPathParserVector[];
  fromString: FromStringVector[];
  imitate: ImitateVector[];
};

function fields(s: Selector): SelectorFields {
  return {
    type: s.selectorType,
    tag: s.tag,
    id: s.id,
    classes: s.classes,
    index: s.index,
    otherAttributes: s.otherAttributes,
    innerText: s.innerText,
    splitClasses: s.splitClasses,
  };
}

function toNode(t: ImitateVector['target']): ImitatorNode {
  return {
    tag: t.tag ?? '',
    id: t.id ?? '',
    classes: t.classes ?? [],
    index: t.index ?? null,
    otherAttributes: t.other ?? {},
    innerText: t.innerText ?? '',
  };
}

describe('CSSSelectorParser (Python parity)', () => {
  it.each(vectors.cssParser)('$selector', (v) => {
    if (!v.ok) {
      expect(() => parseCssSelector(v.selector)).toThrow(ParsingError);
      return;
    }
    expect(parseCssSelector(v.selector)).toEqual({
      tag: v.tag,
      id: v.id,
      classes: v.classes,
      attributes: v.attributes,
    });
  });
});

describe('XPathParser (Python parity)', () => {
  it.each(vectors.xpathParser)('$selector', (v) => {
    if (!v.ok) {
      expect(() => parseXPathSelector(v.selector)).toThrow(ParsingError);
      return;
    }
    expect(parseXPathSelector(v.selector)).toEqual({
      tag: v.tag,
      id: v.id,
      classes: v.classes,
      attributes: v.attributes,
      index: v.index,
      innerText: v.innerText,
    });
  });

  it('reproduces the upstream last-digit index quirk ([12] => 2)', () => {
    expect(parseXPathSelector('//input[12]').index).toBe(2);
  });
});

describe('Selector.from_type_and_value + __str__ (Python parity)', () => {
  it.each(vectors.fromString)('$type $value', (v) => {
    if (!v.ok) {
      expect(() => selectorFromTypeAndValue(v.type as SelectorType, v.value)).toThrow();
      return;
    }
    const selector = selectorFromTypeAndValue(v.type as SelectorType, v.value);
    expect(fields(selector)).toEqual(v.fields);
    if (v.string !== undefined) {
      expect(selectorToString(selector)).toBe(v.string);
    }
  });
});

describe('SelectorImitator.imitate (Python parity)', () => {
  it.each(vectors.imitate)('$type $userValue', (v) => {
    const user = selectorFromTypeAndValue(v.type as SelectorType, v.userValue);
    const node = toNode(v.target);
    if (!v.ok) {
      expect(() => imitate(user, node)).toThrow(ImitationError);
      expect(() => imitate(user, node)).toThrow(v.error);
      return;
    }
    const results = imitate(user, node);
    expect(results).toHaveLength(v.results!.length);
    results.forEach((result, i) => {
      const expected = v.results![i]!;
      expect(fields(result)).toEqual({
        type: expected.type,
        tag: expected.tag,
        id: expected.id,
        classes: expected.classes,
        index: expected.index,
        otherAttributes: expected.otherAttributes,
        innerText: expected.innerText,
        splitClasses: expected.splitClasses,
      });
      if (expected.string !== undefined) {
        expect(selectorToString(result)).toBe(expected.string);
      }
    });
  });
});

describe('imitator helpers', () => {
  it('removeQuotedText strips quoted spans greedily', () => {
    expect(removeQuotedText("input[data-x='a#b.c']#real")).toBe('input[data-x=]#real');
    expect(removeQuotedText('plain')).toBe('plain');
  });

  it('splitClasses mirrors Python str.split()', () => {
    expect(splitClasses('')).toEqual([]);
    expect(splitClasses('  a  b ')).toEqual(['a', 'b']);
    expect(splitClasses('a')).toEqual(['a']);
  });
});