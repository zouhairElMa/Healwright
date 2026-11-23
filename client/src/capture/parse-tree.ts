import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { Node } from '../model/node.js';

type P5ChildNode = DefaultTreeAdapterMap['childNode'];
type P5Element = DefaultTreeAdapterMap['element'];
type P5TextNode = DefaultTreeAdapterMap['textNode'];

/**
 * HTML -> Node tree, port of JsoupHTMLParser (tree-comparing 0.4.14, JsoupHTMLParser.java:41-85)
 * on top of parse5 instead of Jsoup. Verified against test/vectors/parse-vectors.json
 * generated from the real JsoupHTMLParser binary.
 */
export function parseTree(html: string): Node | null {
  const document = parse(html);
  const htmlElement = findHtml(document.childNodes);
  if (htmlElement === null) {
    return null;
  }
  return traverse(htmlElement, 0, []);
}

function isElement(node: P5ChildNode): node is P5Element {
  return 'tagName' in node && 'attrs' in node;
}

function isTextNode(node: P5ChildNode): node is P5TextNode {
  return node.nodeName === '#text';
}

function findHtml(nodes: readonly P5ChildNode[]): P5Element | null {
  for (const node of nodes) {
    if (isElement(node) && node.tagName === 'html') {
      return node;
    }
  }
  const next: P5ChildNode[] = [];
  for (const node of nodes) {
    if ('childNodes' in node) {
      next.push(...node.childNodes);
    }
  }
  return next.length === 0 ? null : findHtml(next);
}

function traverse(element: P5Element, index: number, ancestors: string[][]): Node {
  const content: string[] = [];
  const depth = [...ancestors, content];
  const children: Node[] = [];
  let indexCounter = 0;
  // Jsoup stores script/style content as DataNode, not TextNode, so it never enters innerText.
  const rawText = element.tagName === 'script' || element.tagName === 'style';

  for (const child of element.childNodes) {
    if (isElement(child)) {
      children.push(traverse(child, indexCounter++, depth));
    } else if (isTextNode(child) && !rawText) {
      const text = normalizeWhitespace(child.value);
      for (const accumulator of depth) {
        accumulator.push(text);
      }
    }
  }

  const attributes = new Map<string, string>();
  for (const { name, value } of element.attrs) {
    if (!attributes.has(name)) {
      attributes.set(name, value);
    }
  }
  const id = attributes.get('id') ?? '';
  const classes = new Set(
    (attributes.get('class') ?? '')
      .split(' ')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
  const otherAttributes = new Map<string, string>();
  for (const [key, value] of attributes) {
    if (key !== 'id' && key !== 'class' && key.trim().length > 0) {
      otherAttributes.set(key, value);
    }
  }

  const node = new Node(element.tagName, id, classes, index, otherAttributes, content.join('\n'));
  node.children = children;
  for (const child of children) {
    child.parent = node;
  }
  return node;
}

/**
 * Jsoup TextNode.text() = StringUtil.normaliseWhitespace: collapse whitespace runs to a
 * single space WITHOUT trimming (leading/trailing space is kept), and NBSP (U+00A0) counts
 * as whitespace. Verified by the "whitespace" and "nbsp" parse vectors.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t\n\f\r\u00a0]+/g, ' ');
}