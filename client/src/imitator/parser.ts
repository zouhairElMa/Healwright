/**
 * Clean-room port of healenium-selector-imitator/src/selector_parser.py (no upstream license).
 * Restricted CSS/XPath grammars only. Python `\w` is Unicode-aware while JS `\w` is ASCII;
 * for the ASCII selectors these grammars accept, behavior matches (documented parity gap).
 */
export class ParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParsingError';
  }
}

function stripChars(s: string, chars: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && chars.includes(s[start]!)) start++;
  while (end > start && chars.includes(s[end - 1]!)) end--;
  return s.slice(start, end);
}

/** ParsingUtils.remove_quoted_text: greedily strip '...' then "..." spans, repeatedly. */
export function removeQuotedText(text: string): string {
  let result = text;
  for (const expression of [/'.*'/, /".*"/]) {
    let match: RegExpExecArray | null;
    while ((match = expression.exec(result)) !== null) {
      result = result.slice(0, match.index) + result.slice(match.index + match[0].length);
    }
  }
  return result;
}

export interface CssParseResult {
  tag: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
}

export function parseCssSelector(selector: string): CssParseResult {
  if (!/^([\w-]*)(\.[\w-]+|#[\w-]+|\[.+])*$/.test(selector)) {
    throw new ParsingError('Cannot parse CSS selector.');
  }
  const tagMatch = selector.match(/^[\w-]+/);
  const withoutQuotes = removeQuotedText(selector);
  const idMatch = withoutQuotes.match(/#([\w-]+)/);
  const classes = [...withoutQuotes.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
  const attributes: Record<string, string> = {};
  for (const raw of selector.matchAll(/\[[^[\]]+]/g)) {
    const m = raw[0].match(/^\[([\w-]+)=('.*'|".*")\]$/);
    if (m !== null) {
      attributes[m[1]!] = stripChars(stripChars(m[2]!, "'"), '"');
    }
  }
  return {
    tag: tagMatch === null ? '' : tagMatch[0],
    id: idMatch === null ? '' : idMatch[1]!,
    classes,
    attributes,
  };
}

export interface XPathParseResult {
  tag: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  index: number | null;
  innerText: string;
}

export function parseXPathSelector(selector: string): XPathParseResult {
  if (!/^\/\/([\w-]*|\*)(\[.+])*$/.test(selector)) {
    throw new ParsingError('Cannot parse XPath selector.');
  }
  const tagMatch = selector.match(/^\/\/([\w-]+)/);
  const idMatch = selector.match(/@id=('[\w-]+'|"[\w-]+")/);
  const id = idMatch === null ? '' : stripChars(stripChars(idMatch[1]!, '"'), "'");

  let classes: string[] = [];
  const allClasses = selector.match(/@class=('[ \w-]+'|"[ \w-]+")/);
  const containsClass = selector.match(/contains\(@class,('[ \w-]+'|"[ \w-]+")\)/);
  const classMatch = allClasses ?? containsClass;
  if (classMatch !== null) {
    classes = stripChars(stripChars(classMatch[1]!, '"'), "'").split(' ');
  }

  const attributes: Record<string, string> = {};
  for (const m of selector.matchAll(/@([\w-]+)=('[^']*'|"[^"]*")/g)) {
    const name = m[1]!;
    if (name !== 'class' && name !== 'id') {
      attributes[name] = stripChars(stripChars(m[2]!, "'"), '"');
    }
  }

  // Upstream regex \[(\d)+] captures only the LAST digit of a multi-digit index.
  const indexMatch = removeQuotedText(selector).match(/\[(\d)+\]/);
  const index = indexMatch === null ? null : Number.parseInt(indexMatch[1]!, 10);

  const textMatch = selector.match(/text\(\)=('[^']*'|"[^"]*")/);
  const innerText = textMatch === null ? '' : textMatch[1]!.slice(1, -1);

  return {
    tag: tagMatch === null ? '' : tagMatch[1]!,
    id,
    classes,
    attributes,
    index,
    innerText,
  };
}