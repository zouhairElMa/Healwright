import type { Node } from '../model/node.js';
import { isBlank, javaTrim } from '../utils/java-string.js';

/**
 * Phase-6 improvement — local XPath generation. Clean-room alternative to the paid hlm-ai
 * getXpathSelector endpoint (out of scope in v1). Produces candidate XPath locators from a healed
 * node in preference order (id, class, other attributes); the engine accepts the first candidate
 * that resolves to the SAME unique element as the CSS-healed locator. Only used for XPath user
 * selectors whose imitation failed, and only when config.localXPathFallback is enabled.
 */

const SKIPPED_ATTRIBUTES = new Set([
  'style',
  'onclick',
  'onChange',
  'onFocus',
  'onLoad',
  'media',
  'height',
  'width',
]);

/** XPath string literal: single quotes, double quotes if the value contains ', else concat(). */
export function xpathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  const inner = value
    .split("'")
    .map((part) => `'${part}'`)
    .join(', "\'", ');
  return `concat(${inner})`;
}

export function xpathCandidates(node: Node): string[] {
  const tag = node.tag === '' ? '*' : node.tag;
  const candidates: string[] = [];

  const id = javaTrim(node.id);
  if (id.length > 0) {
    candidates.push(`//${tag}[@id=${xpathLiteral(id)}]`);
  }

  const classes = [...node.classes].filter((clazz) => !isBlank(clazz));
  if (classes.length > 0) {
    candidates.push(`//${tag}[@class=${xpathLiteral(classes.join(' '))}]`);
    for (const clazz of classes) {
      candidates.push(`//${tag}[contains(@class,${xpathLiteral(clazz)})]`);
    }
  }

  for (const [key, value] of node.otherAttributes) {
    const name = javaTrim(key);
    const trimmed = javaTrim(value);
    if (isBlank(name) || isBlank(trimmed) || SKIPPED_ATTRIBUTES.has(name)) {
      continue;
    }
    candidates.push(`//${tag}[@${name}=${xpathLiteral(trimmed)}]`);
  }

  return candidates;
}