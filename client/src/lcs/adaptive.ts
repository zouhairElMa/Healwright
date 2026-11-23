/**
 * Phase 16 — opt-in 'adaptive' decision layer. It replaces the global indexWeight knob with
 * signals that are actually informative at heal time:
 *
 * - preserved signals: exact id, distinctive text/classes, non-generic attribute values that
 *   survived the change (F4b genericity applies, so `type="button"` shared by every candidate
 *   identifies nothing);
 * - neighbourhood context: the previous/next element siblings captured on the last successful
 *   action. This is the relational form of position: it survives insertions elsewhere, whereas
 *   an absolute sibling index points at whichever element now occupies the old slot;
 * - stable position: equal index AND equal sibling count with the captured context. Position is
 *   only a tiebreak and can never justify a heal on its own (a sibling insertion makes the old
 *   index point at a different element — measured on look-alikes, phase16 spike).
 *
 * A heal requires a unique top candidate that carries either full neighbourhood context (both
 * siblings match) or at least one preserved signal. Ties and evidence-free tops are refused:
 * refusing is a correct outcome, a wrong target is not. No weights are learned online; the
 * constants below are global and fixed.
 */
import type { Node } from '../model/node.js';
import type { ScoredNode } from './path-finder.js';
import { genericAttributeValues, normalizedText } from './scoring.js';

export interface NeighborSignature {
  tag: string;
  id: string;
  classes: string[];
  text: string;
}

/** Identity of the located element itself, captured with its neighbours. */
export interface ElementIdentity {
  tag: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  text: string;
  hidden: boolean;
}

/** Captured on the last successful action (wrapper) and kept in-process only. */
export interface ReferenceSnapshot {
  index: number;
  siblingCount: number;
  prev: NeighborSignature | null;
  next: NeighborSignature | null;
  self?: ElementIdentity;
}

/**
 * State attributes flip on interaction (a toggle's aria-pressed, an input's value, the backlight
 * style): they describe what the element is doing, not which element it is.
 */
const VOLATILE_ATTRIBUTES = new Set([
  'style',
  'value',
  'checked',
  'selected',
  'disabled',
  'readonly',
  'hidden',
  'open',
  'inert',
  'tabindex',
  'aria-pressed',
  'aria-checked',
  'aria-expanded',
  'aria-selected',
  'aria-current',
  'aria-busy',
  'aria-hidden',
  'aria-disabled',
  'aria-invalid',
  'aria-valuenow',
  'aria-valuetext',
  'aria-activedescendant',
  'aria-live',
  'data-state',
  'data-active',
  'data-selected',
  'data-focus',
  'data-focused',
  'data-focus-visible',
  'data-hover',
  'data-hovered',
  'data-pressed',
  'data-checked',
  'data-open',
  'data-expanded',
  'data-disabled',
  'data-loading',
  'data-highlighted',
]);

export function isVolatileAttribute(name: string): boolean {
  return VOLATILE_ATTRIBUTES.has(name.toLowerCase());
}

/** Attributes authored to name one element; a unique surviving value can pull it into the pool. */
const ANCHOR_ATTRIBUTES = new Set([
  'name',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'placeholder',
  'title',
  'alt',
  'for',
  'src',
  'href',
  'form',
  'list',
]);

export function isAnchorAttribute(name: string, value: string): boolean {
  const key = name.toLowerCase();
  if (value.trim() === '' || isVolatileAttribute(key)) {
    return false;
  }
  if (key === 'href') {
    return !value.startsWith('#') && !value.toLowerCase().startsWith('javascript:');
  }
  return ANCHOR_ATTRIBUTES.has(key) || key.startsWith('data-');
}

function walk(root: Node, visit: (node: Node) => void): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]!);
    }
  }
}

function isHiddenNode(node: Node): boolean {
  for (let current: Node | null = node; current !== null; current = current.parent) {
    if (current.otherAttributes.has('hidden') || current.otherAttributes.get('aria-hidden') === 'true' ||
      current.otherAttributes.has('inert')) {
      return true;
    }
  }
  return false;
}

/**
 * Nodes outside the LCS pool that still carry a document-unique id or anchor attribute value of
 * the reference. A changed tag, wrapper and text can push the real target below the score cap
 * while its data-testid (or id) survived; without this the decision never even sees it.
 */
export function anchorNodes(reference: Node, root: Node, limit = 25): Node[] {
  const wanted = new Map<string, string>();
  for (const [name, value] of reference.otherAttributes) {
    if (isAnchorAttribute(name, value)) {
      wanted.set(name, value);
    }
  }
  const referenceId = reference.id.trim();
  if (wanted.size === 0 && referenceId === '') {
    return [];
  }
  const hits = new Map<string, Node[]>();
  const hit = (key: string, node: Node): void => {
    const list = hits.get(key);
    if (list === undefined) {
      hits.set(key, [node]);
    } else {
      list.push(node);
    }
  };
  walk(root, (node) => {
    if (referenceId !== '' && node.id === reference.id) {
      hit('#id', node);
    }
    for (const [name, value] of wanted) {
      if (node.otherAttributes.get(name) === value) {
        hit(name, node);
      }
    }
  });
  const result: Node[] = [];
  for (const nodes of hits.values()) {
    if (nodes.length === 1 && !result.includes(nodes[0]!)) {
      result.push(nodes[0]!);
    }
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

/**
 * True when the element the locator resolves to now is no longer the one captured on the last
 * success: its tag, id, classes or one non-volatile attribute changed.
 *
 * Text is deliberately excluded: counters, toggles and status labels rewrite it on interaction,
 * and treating that as identity drift would ask the engine to redirect after every click. Becoming
 * hidden is excluded too — a hidden element cannot be clicked, so the normal not-found/action
 * failure already routes that case to healing. Drift alone never redirects an action; it only asks
 * the engine whether another element matches the reference clearly better.
 */
export function identityDrift(before: ElementIdentity, now: ElementIdentity): boolean {
  if (before.tag !== now.tag || before.id !== now.id) {
    return true;
  }
  const beforeClasses = [...before.classes].map((name) => name.trim()).filter((name) => name !== '').sort().join(' ');
  const nowClasses = [...now.classes].map((name) => name.trim()).filter((name) => name !== '').sort().join(' ');
  if (beforeClasses !== nowClasses) {
    return true;
  }
  for (const [name, value] of Object.entries(before.attributes)) {
    if (isVolatileAttribute(name)) {
      continue;
    }
    if (now.attributes[name] !== value) {
      return true;
    }
  }
  return false;
}

export interface AdaptiveCandidate {
  node: Node;
  /** Healenium score that put the node in the candidate pool (ranking, not the decision). */
  score: number;
  total: number;
  /** Number of captured neighbours (0..2) still identical at the candidate. */
  context: number;
  /**
   * Every captured (non-null) neighbour still matches and at least one of them is unique in the
   * document — e.g. the label text span right before an input.
   */
  contextFull: boolean;
  /** Names of the preserved signals that matched (`id`, `text`, `class:<name>`, `attr:<name>`). */
  signals: string[];
  /** Index and sibling count still equal to the captured context. */
  position: boolean;
}

export type AdaptiveReason = 'adaptive-heal' | 'adaptive-ambiguous' | 'adaptive-no-evidence';

export interface AdaptiveDecision {
  winner: ScoredNode | null;
  reason: AdaptiveReason;
  candidates: AdaptiveCandidate[];
}

export const ADAPTIVE_CONTEXT_WEIGHT = 4;
export const ADAPTIVE_SIGNAL_WEIGHT = 2;
export const ADAPTIVE_POSITION_WEIGHT = 1;

function normalizeNeighbor(signature: NeighborSignature | null): NeighborSignature | null {
  if (signature === null) {
    return null;
  }
  return {
    tag: signature.tag.toLowerCase(),
    id: signature.id,
    classes: [...new Set(signature.classes.map((name) => name.trim()).filter((name) => name !== ''))].sort(),
    text: normalizedText(signature.text),
  };
}

function neighborOf(node: Node | undefined): NeighborSignature | null {
  if (node === undefined) {
    return null;
  }
  return normalizeNeighbor({
    tag: node.tag,
    id: node.id,
    classes: [...node.classes],
    text: node.innerText,
  });
}

function siblings(node: Node): { prev: NeighborSignature | null; next: NeighborSignature | null; siblingCount: number } {
  const parent = node.parent;
  if (parent === null) {
    return { prev: null, next: null, siblingCount: 1 };
  }
  const at = parent.children.indexOf(node);
  return {
    prev: neighborOf(at > 0 ? parent.children[at - 1] : undefined),
    next: neighborOf(at >= 0 ? parent.children[at + 1] : undefined),
    siblingCount: parent.children.length,
  };
}

function sameNeighbor(a: NeighborSignature | null, b: NeighborSignature | null): boolean {
  if (a === null || b === null) {
    return a === null && b === null;
  }
  return a.tag === b.tag && a.id === b.id && a.text === b.text &&
    a.classes.length === b.classes.length && a.classes.every((name, index) => name === b.classes[index]);
}

/** A value shared by more than `ratio` of the pool describes the group, not the element. */
function isDistinctive(values: readonly string[], value: string, ratio: number): boolean {
  if (!(ratio < 1)) {
    return true;
  }
  if (values.length < 2) {
    return true;
  }
  const shared = values.filter((entry) => entry === value).length;
  return shared <= ratio * values.length;
}

export interface AdaptiveOptions {
  genericAttributeRatio?: number;
  /** Whole candidate document: enables document-unique neighbour context. */
  root?: Node;
}

function signatureKey(signature: NeighborSignature): string {
  return `${signature.tag}\u0000${signature.id}\u0000${signature.classes.join(' ')}\u0000${signature.text}`;
}

function neighborCounts(root: Node): Map<string, number> {
  const counts = new Map<string, number>();
  walk(root, (node) => {
    const signature = neighborOf(node);
    if (signature !== null) {
      const key = signatureKey(signature);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return counts;
}

function informative(signature: NeighborSignature): boolean {
  return signature.id !== '' || signature.text !== '';
}

export function decideAdaptive(
  reference: Node,
  scoreds: readonly ScoredNode[],
  snapshot: ReferenceSnapshot | null,
  options: AdaptiveOptions = {},
): AdaptiveDecision {
  const ratio = options.genericAttributeRatio ?? 0.5;
  const deduped: ScoredNode[] = [];
  const seen = new Set<Node>();
  for (const scored of scoreds) {
    if (!seen.has(scored.node)) {
      seen.add(scored.node);
      deduped.push(scored);
    }
  }
  // A hidden candidate cannot be the element the user acted on when the reference was visible
  // (a hidden twin wearing the old class); keep them only when nothing visible remains.
  const referenceHidden = isHiddenNode(reference);
  const visible = referenceHidden ? deduped : deduped.filter((scored) => !isHiddenNode(scored.node));
  const pool = visible.length > 0 ? visible : deduped;
  const counts = options.root !== undefined && snapshot !== null ? neighborCounts(options.root) : null;
  const unique = (signature: NeighborSignature): boolean =>
    counts !== null && informative(signature) && (counts.get(signatureKey(signature)) ?? 0) === 1;

  const nodes = pool.map((scored) => scored.node);
  const generic = genericAttributeValues(nodes, ratio);
  const texts = nodes.map((node) => normalizedText(node.innerText)).filter((text) => text !== '');
  const classSets = nodes
    .map((node) => [...node.classes].sort().join(' '))
    .filter((classes) => classes !== '');
  const referenceText = normalizedText(reference.innerText);

  const candidates = pool.map((scored): AdaptiveCandidate => {
    const node = scored.node;
    const signals: string[] = [];
    if (reference.id !== '' && node.id === reference.id) {
      signals.push('id');
    }
    if (referenceText !== '' && referenceText === normalizedText(node.innerText) &&
      isDistinctive(texts, referenceText, ratio)) {
      signals.push('text');
    }
    if (reference.classes.size > 0) {
      const referenceClasses = [...reference.classes].sort().join(' ');
      const candidateClasses = [...node.classes].sort().join(' ');
      if (referenceClasses === candidateClasses && isDistinctive(classSets, referenceClasses, ratio)) {
        signals.push('class');
      }
    }
    for (const [name, value] of reference.otherAttributes) {
      if (isVolatileAttribute(name) || node.otherAttributes.get(name) !== value) {
        continue;
      }
      if (generic.get(name)?.has(value) === true) {
        continue;
      }
      signals.push(`attr:${name}`);
    }

    const siblingsNow = siblings(node);
    // An absent neighbour is not evidence: counting two nulls as a full context match gave
    // every single-child button the same score and turned unique tops into ambiguous ties.
    const prevRef = snapshot === null ? null : normalizeNeighbor(snapshot.prev);
    const nextRef = snapshot === null ? null : normalizeNeighbor(snapshot.next);
    const prevMatch = prevRef !== null && sameNeighbor(prevRef, siblingsNow.prev);
    const nextMatch = nextRef !== null && sameNeighbor(nextRef, siblingsNow.next);
    const context = Number(prevMatch) + Number(nextMatch);
    const available = Number(prevRef !== null) + Number(nextRef !== null);
    const contextFull = available > 0 && context === available &&
      ((prevMatch && unique(prevRef!)) || (nextMatch && unique(nextRef!)));
    const position = snapshot !== null && siblingsNow.siblingCount === snapshot.siblingCount &&
      node.index === snapshot.index;

    return {
      node,
      score: scored.score,
      context,
      contextFull,
      signals,
      position,
      total:
        ADAPTIVE_CONTEXT_WEIGHT * context +
        ADAPTIVE_SIGNAL_WEIGHT * signals.length +
        (position ? ADAPTIVE_POSITION_WEIGHT : 0),
    };
  });

  candidates.sort((a, b) => b.total - a.total || b.score - a.score);
  const top = candidates[0];
  if (top === undefined) {
    return { winner: null, reason: 'adaptive-no-evidence', candidates };
  }
  const tied = candidates.filter((entry) => entry.total === top.total);
  if (tied.length > 1) {
    return { winner: null, reason: 'adaptive-ambiguous', candidates };
  }
  // Position alone never justifies a heal: it is the knob that pointed at the wrong sibling.
  if (top.context < 2 && !top.contextFull && top.signals.length === 0) {
    return { winner: null, reason: 'adaptive-no-evidence', candidates };
  }
  const original = pool.find((scored) => scored.node === top.node);
  return original === undefined
    ? { winner: null, reason: 'adaptive-no-evidence', candidates }
    : { winner: original, reason: 'adaptive-heal', candidates };
}
