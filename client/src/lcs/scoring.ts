/**
 * Phase-11/12 scoring profile. The default mode 'healenium' keeps the tree-comparing 0.4.14
 * formula byte-for-byte (see node-distance.ts). Mode 'improved' selects the five candidate
 * improvements planned in phase 11 (F1..F5); each one can be disabled individually so its
 * effect stays measurable (docs/phase-12-scoring.md).
 *
 * F1 emptyNeutrality   : an attribute absent on both sides is not scored (no free points) and
 *                        the score is renormalized on the maximum actually attainable.
 * F2 positionTiebreak  : sibling index equality is worth points, but only when the id does not
 *                        already identify the element (an exact id match must not be overridden).
 * F3 distinctiveSignals: an exact class set or exact text grants the tag points even when the
 *                        tag changed: distinctive signals substitute for tag equality, so a tag
 *                        change is tolerated when classes and text agree.
 * F4 minimumEvidence   : a candidate must carry at least one real identity signal (id, shared
 *                        class, exact text or an unchanged attribute), not only tag + structure.
 *                        F4b genericAttributes discounts an attribute value shared by more than
 *                        a configurable share of the candidate population (it identifies nothing).
 * F5 ambiguityGuard    : refuse when the two best distinct candidates are within a margin.
 */
import type { Node } from '../model/node.js';
import { calculateLevenshteinScore } from './levenshtein.js';
import { intersect } from './sets.js';

export type ScoringMode = 'healwright' | 'healenium' | 'improved' | 'adaptive';

export interface ScoringImprovements {
  emptyNeutrality?: boolean;
  positionTiebreak?: boolean;
  distinctiveSignals?: boolean;
  minimumEvidence?: boolean;
  ambiguityGuard?: boolean;
  /** Absolute score gap under which two candidates count as ambiguous (default 0.02). */
  ambiguityMargin?: number;
  /** Levenshtein acceptance threshold for an id / attribute signal; higher = more permissive. */
  evidenceSimilarity?: number;
  /** Points awarded for an equal sibling index in improved mode (default 20). */
  indexWeight?: number;
  /**
   * F4b: an attribute value carried by more than this share of the candidate population is
   * generic and does not count as identity evidence (default 0.5; >= 1 disables the rule).
   */
  genericAttributeRatio?: number;
}

export interface ScoringProfile {
  mode: ScoringMode;
  emptyNeutrality: boolean;
  positionTiebreak: boolean;
  distinctiveSignals: boolean;
  minimumEvidence: boolean;
  ambiguityGuard: boolean;
  ambiguityMargin: number;
  evidenceSimilarity: number;
  indexWeight: number;
  genericAttributeRatio: number;
}

export const IMPROVEMENT_FLAGS = [
  'emptyNeutrality',
  'positionTiebreak',
  'distinctiveSignals',
  'minimumEvidence',
  'ambiguityGuard',
] as const;

export type ImprovementFlag = (typeof IMPROVEMENT_FLAGS)[number];

export const DEFAULT_AMBIGUITY_MARGIN = 0.02;
/**
 * Levenshtein acceptance threshold for an id / attribute identity signal (F4). It is the
 * distance fraction passed to calculateLevenshteinScore, so a higher value is more permissive
 * (the accepted similarity floor is roughly 1 - threshold - 1/length).
 */
export const MINIMUM_EVIDENCE_SIMILARITY = 0.45;
/** Points for an equal sibling index in improved mode (F2). */
export const DEFAULT_INDEX_WEIGHT = 20;
/**
 * F4b: share of the candidate population above which an attribute value stops counting as
 * identity evidence (0.5 = a value carried by most candidates is generic). `>= 1` disables.
 */
export const DEFAULT_GENERIC_ATTRIBUTE_RATIO = 0.5;

export const DEFAULT_IMPROVEMENTS: ScoringImprovements = {
  emptyNeutrality: true,
  positionTiebreak: true,
  distinctiveSignals: true,
  minimumEvidence: true,
  ambiguityGuard: true,
  ambiguityMargin: DEFAULT_AMBIGUITY_MARGIN,
  evidenceSimilarity: MINIMUM_EVIDENCE_SIMILARITY,
  indexWeight: DEFAULT_INDEX_WEIGHT,
  genericAttributeRatio: DEFAULT_GENERIC_ATTRIBUTE_RATIO,
};

export const HEALENIUM_PROFILE: ScoringProfile = {
  mode: 'healenium',
  emptyNeutrality: false,
  positionTiebreak: false,
  distinctiveSignals: false,
  minimumEvidence: false,
  ambiguityGuard: false,
  ambiguityMargin: 0,
  evidenceSimilarity: MINIMUM_EVIDENCE_SIMILARITY,
  indexWeight: DEFAULT_INDEX_WEIGHT,
  genericAttributeRatio: 1,
};

export const HEALWRIGHT_PROFILE: ScoringProfile = {
  ...HEALENIUM_PROFILE,
  mode: 'healwright',
};

/**
 * Phase-16 adaptive mode. The Healenium formula still builds the candidate pool (no index
 * points at all); the decision is delegated to lcs/adaptive.ts, which needs neither F4/F5 nor
 * indexWeight. genericAttributeRatio is reused for the genericity discount.
 */
export const ADAPTIVE_PROFILE: ScoringProfile = {
  mode: 'adaptive',
  emptyNeutrality: false,
  positionTiebreak: false,
  distinctiveSignals: false,
  minimumEvidence: false,
  ambiguityGuard: false,
  ambiguityMargin: 0,
  evidenceSimilarity: MINIMUM_EVIDENCE_SIMILARITY,
  indexWeight: 0,
  genericAttributeRatio: DEFAULT_GENERIC_ATTRIBUTE_RATIO,
};

/** Improved mode with every fix disabled, used to prove it reproduces Healenium exactly. */
export const IMPROVED_BASELINE_PROFILE: ScoringProfile = {
  mode: 'improved',
  emptyNeutrality: false,
  positionTiebreak: false,
  distinctiveSignals: false,
  minimumEvidence: false,
  ambiguityGuard: false,
  ambiguityMargin: 0,
  evidenceSimilarity: MINIMUM_EVIDENCE_SIMILARITY,
  indexWeight: DEFAULT_INDEX_WEIGHT,
  genericAttributeRatio: 1,
};

export function resolveScoringProfile(config: {
  scoring?: ScoringMode;
  improvements?: ScoringImprovements;
}): ScoringProfile {
  if (config.scoring === 'healwright') {
    return HEALWRIGHT_PROFILE;
  }
  if (config.scoring === 'adaptive') {
    const imp = config.improvements ?? {};
    return {
      ...ADAPTIVE_PROFILE,
      genericAttributeRatio: imp.genericAttributeRatio ?? DEFAULT_GENERIC_ATTRIBUTE_RATIO,
    };
  }
  if (config.scoring !== 'improved') {
    return HEALENIUM_PROFILE;
  }
  const imp = config.improvements ?? {};
  return {
    mode: 'improved',
    emptyNeutrality: imp.emptyNeutrality ?? true,
    positionTiebreak: imp.positionTiebreak ?? true,
    distinctiveSignals: imp.distinctiveSignals ?? true,
    minimumEvidence: imp.minimumEvidence ?? true,
    ambiguityGuard: imp.ambiguityGuard ?? true,
    ambiguityMargin: imp.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN,
    evidenceSimilarity: imp.evidenceSimilarity ?? MINIMUM_EVIDENCE_SIMILARITY,
    indexWeight: imp.indexWeight ?? DEFAULT_INDEX_WEIGHT,
    genericAttributeRatio: imp.genericAttributeRatio ?? DEFAULT_GENERIC_ATTRIBUTE_RATIO,
  };
}

/** Whitespace-collapsed, trimmed, lowercased text used by F3 exact-text and F4 evidence. */
export function normalizedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * F4b: attribute values (per attribute name) carried by more than `ratio` of the DISTINCT
 * candidates in `pool`. Such a value is generic — it describes the group, not the element —
 * so it must not count as identity evidence. `ratio >= 1` disables the rule, and a pool of
 * fewer than two candidates leaves it inert (there is no population to compare against).
 */
export function genericAttributeValues(
  pool: readonly Node[],
  ratio: number,
): Map<string, Set<string>> {
  const generic = new Map<string, Set<string>>();
  if (!(ratio < 1)) {
    return generic;
  }
  const distinct = [...new Set(pool)];
  if (distinct.length < 2) {
    return generic;
  }
  const counts = new Map<string, Map<string, number>>();
  for (const node of distinct) {
    for (const [name, value] of node.otherAttributes) {
      let values = counts.get(name);
      if (values === undefined) {
        values = new Map();
        counts.set(name, values);
      }
      values.set(value, (values.get(value) ?? 0) + 1);
    }
  }
  const threshold = ratio * distinct.length;
  for (const [name, values] of counts) {
    for (const [value, count] of values) {
      if (count > threshold) {
        let shared = generic.get(name);
        if (shared === undefined) {
          shared = new Set();
          generic.set(name, shared);
        }
        shared.add(value);
      }
    }
  }
  return generic;
}

export interface EvidenceOptions {
  /** Values discounted by F4b (see genericAttributeValues); unset = no discount. */
  genericAttributes?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * F4: at least one signal that ties the candidate to the reference beyond tag + structure.
 * Signals: similar non-empty id, a shared non-empty class, identical non-empty text, or a
 * common attribute (same name) whose value is similar and not discounted as generic.
 */
export function hasMinimumIdentityEvidence(
  reference: Node,
  candidate: Node,
  similarity = MINIMUM_EVIDENCE_SIMILARITY,
  options: EvidenceOptions = {},
): boolean {
  if (
    reference.id !== '' &&
    candidate.id !== '' &&
    calculateLevenshteinScore(reference.id, candidate.id, similarity) > 0
  ) {
    return true;
  }
  if (intersect(reference.classes, candidate.classes).size > 0) {
    return true;
  }
  const referenceText = normalizedText(reference.innerText);
  if (referenceText !== '' && referenceText === normalizedText(candidate.innerText)) {
    return true;
  }
  for (const [name, value] of reference.otherAttributes) {
    const other = candidate.otherAttributes.get(name);
    if (other === undefined) {
      continue;
    }
    if (options.genericAttributes?.get(name)?.has(other) === true) {
      continue;
    }
    if (calculateLevenshteinScore(value, other, similarity) > 0) {
      return true;
    }
  }
  return false;
}

export interface ScoreEntry {
  score: number;
  node: Node;
}

export interface Ambiguity {
  first: ScoreEntry;
  second: ScoreEntry;
  margin: number;
}

/**
 * F5: the two best DISTINCT nodes (the scores map can repeat a node once per leaf path).
 * Returns null when fewer than two candidates exist or the gap is at least the margin.
 */
export function findAmbiguity(entries: readonly ScoreEntry[], margin: number): Ambiguity | null {
  if (margin <= 0) {
    return null;
  }
  const seen = new Set<Node>();
  const top: ScoreEntry[] = [];
  for (const entry of entries) {
    if (top.length >= 2) {
      break;
    }
    if (seen.has(entry.node)) {
      continue;
    }
    seen.add(entry.node);
    top.push(entry);
  }
  const first = top[0];
  const second = top[1];
  if (first === undefined || second === undefined) {
    return null;
  }
  return first.score - second.score < margin ? { first, second, margin } : null;
}

/** Human-readable node identity for telemetry / diagnostics. */
export function describeNode(node: Node): string {
  const id = node.id === '' ? '' : `#${node.id}`;
  const classes = [...node.classes];
  const cls = classes.length === 0 ? '' : `.${classes.join('.')}`;
  const text = normalizedText(node.innerText).slice(0, 40);
  // An empty text used to render as `input ""`, which reads as a second broken locator.
  return text === '' ? `${node.tag}${id}${cls}` : `${node.tag}${id}${cls} "${text}"`;
}
