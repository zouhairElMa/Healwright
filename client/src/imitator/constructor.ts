/**
 * Clean-room port of healenium-selector-imitator/src/selector_to_string.py (no upstream license).
 */
export interface CssParts {
  tag: string | null;
  id: string | null;
  classes: string[] | null;
  otherAttributes: Record<string, string> | null;
}

export function cssSelectorString(parts: CssParts): string {
  let result = '';
  if (parts.tag !== null) {
    result += parts.tag;
  }
  if (parts.id !== null) {
    result += `#${parts.id}`;
  }
  for (const className of parts.classes ?? []) {
    result += `.${className}`;
  }
  for (const [name, value] of Object.entries(parts.otherAttributes ?? {})) {
    result += `[${name}='${value}']`;
  }
  return result;
}

export interface XPathParts extends CssParts {
  index: number | null;
  innerText: string | null;
}

export function xpathSelectorString(parts: XPathParts, splitClasses = false): string {
  let result = '//';
  result += parts.tag === null ? '*' : parts.tag;
  if (parts.id !== null) {
    result += `[@id='${parts.id}']`;
  }
  const classes = parts.classes ?? [];
  if (splitClasses) {
    for (const className of classes) {
      result += `[contains(@class, '${className}')]`;
    }
  } else if (classes.length > 0) {
    result += `[@class='${classes.join(' ')}']`;
  }
  for (const [name, value] of Object.entries(parts.otherAttributes ?? {})) {
    result += `[@${name}='${value}']`;
  }
  if (parts.innerText !== null) {
    result += `[text()='${parts.innerText}']`;
  }
  if (parts.index !== null) {
    result += `[${parts.index}]`;
  }
  return result;
}