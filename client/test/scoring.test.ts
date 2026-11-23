import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WireNode } from '../src/backend/wire.js';
import { nodeFromWire } from '../src/backend/wire.js';
import { parseTree } from '../src/capture/parse-tree.js';
import { findScoresToNodes, getSortedNodes } from '../src/lcs/path-finder.js';
import type { ScoredNode } from '../src/lcs/path-finder.js';
import { heuristicNodeDistance } from '../src/lcs/node-distance.js';
import {
  findAmbiguity,
  genericAttributeValues,
  hasMinimumIdentityEvidence,
  HEALWRIGHT_PROFILE,
  HEALENIUM_PROFILE,
  IMPROVED_BASELINE_PROFILE,
  resolveScoringProfile,
} from '../src/lcs/scoring.js';
import type { ScoringProfile } from '../src/lcs/scoring.js';
import { Node } from '../src/model/node.js';

interface CandidateFixture {
  score: number;
  element: string;
  tag: string;
  id: string;
  classes: string[];
  innerText: string;
}

interface Phase10Candidates {
  totalScoredNodes: number;
  top: CandidateFixture[];
  expected: CandidateFixture;
}

type FixtureName = 'row_2' | 'span_status' | 'obsolete';

const evidence = new URL('../../docs/evidence/', import.meta.url);

// Phase 10 candidate snapshots use canonical mutations; raw captures contain runtime random suffixes.
function canonicalPhase10Html(name: FixtureName, html: string): string {
  let canonical = html.replaceAll(/id="row_two_[a-z0-9]+"/g, 'id="row_two"');
  if (name === 'span_status') {
    canonical = canonical.replace(
      /<(strong|em|b) class="status">Ready<\/\1>/g,
      '<strong class="status">Ready</strong>',
    );
  }
  if (name === 'obsolete') {
    canonical = canonical
      .replaceAll(/id="cancel_[a-z0-9]+"/g, 'id="cancel_btn"')
      .replaceAll(/>Cancel [a-z0-9]+<\/button>/g, '>Cancel</button>');
  }
  return canonical;
}

function load(name: FixtureName): {
  path: Node[];
  destination: Node;
  rawDestination: Node;
  fixture: Phase10Candidates;
} {
  const reference = JSON.parse(
    readFileSync(new URL(`phase10-reference-${name}.json`, evidence), 'utf8'),
  ) as { paths: WireNode[][] };
  const html = readFileSync(new URL(`phase10-dom-after-${name}.html`, evidence), 'utf8');
  const fixture = JSON.parse(
    readFileSync(new URL(`phase10-candidates-${name}.json`, evidence), 'utf8'),
  ) as Phase10Candidates;
  const destination = parseTree(canonicalPhase10Html(name, html));
  const rawDestination = parseTree(html);
  if (destination === null || rawDestination === null) {
    throw new Error(`could not parse ${name} DOM`);
  }
  const wirePath = reference.paths[0];
  if (wirePath === undefined) {
    throw new Error(`${name} reference has no path`);
  }
  return { path: wirePath.map(nodeFromWire), destination, rawDestination, fixture };
}

const fixtures = {
  row_2: load('row_2'),
  span_status: load('span_status'),
  obsolete: load('obsolete'),
};

function rank(
  name: keyof typeof fixtures,
  profile: ScoringProfile,
  destination = fixtures[name].destination,
): ScoredNode[] {
  const { path } = fixtures[name];
  return getSortedNodes(findScoresToNodes(path, destination, profile).scores, 1000, 0.6);
}

describe('captures Phase 10 brutes — jetons aléatoires conservés', () => {
  it('row_2 retains the runtime suffix and its observed Healenium score', () => {
    const ranked = rank('row_2', HEALENIUM_PROFILE, fixtures.row_2.rawDestination);
    const target = ranked.find((scored) => /^row_two_[a-z0-9]+$/.test(scored.node.id));
    expect(target?.node.id).not.toBe('row_two');
    expect(target?.score).toBeCloseTo(6 / 7, 12);
  });

  it('span_status retains the captured replacement tag and shared identity signals', () => {
    const ranked = rank('span_status', HEALENIUM_PROFILE, fixtures.span_status.rawDestination);
    const target = ranked.find(
      (scored) => scored.node.classes.has('status') && scored.node.innerText === 'Ready',
    );
    expect(target).toBeDefined();
    expect(['strong', 'em', 'b']).toContain(target!.node.tag);
    expect(target!.node.tag).not.toBe('span');
  });

  it('obsolete retains the random Cancel id and text without inventing an identity match', () => {
    const ranked = rank('obsolete', HEALENIUM_PROFILE, fixtures.obsolete.rawDestination);
    expect(ranked[0]?.node.id).toMatch(/^cancel_[a-z0-9]+$/);
    expect(ranked[0]?.node.innerText).toMatch(/^Cancel [a-z0-9]+$/);
    expect(ranked[0]?.score).toBeCloseTo(0.7714285714285715, 12);
  });
});

function improved(
  flags: Partial<Omit<ScoringProfile, 'mode'>> = {},
): ScoringProfile {
  return resolveScoringProfile({
    scoring: 'improved',
    improvements: {
      emptyNeutrality: false,
      positionTiebreak: false,
      distinctiveSignals: false,
      minimumEvidence: false,
      ambiguityGuard: false,
      ...flags,
    },
  });
}

const F1 = improved({ emptyNeutrality: true });
const F1_F2 = improved({ emptyNeutrality: true, positionTiebreak: true });
const F1_F2_F3 = improved({
  emptyNeutrality: true,
  positionTiebreak: true,
  distinctiveSignals: true,
});

function node(init: {
  tag?: string;
  id?: string;
  classes?: string[];
  index?: number;
  other?: Record<string, string>;
  text?: string;
}): Node {
  return new Node(
    init.tag ?? '',
    init.id ?? '',
    new Set(init.classes ?? []),
    init.index ?? 0,
    new Map(Object.entries(init.other ?? {})),
    init.text ?? '',
  );
}

describe('mode healenium — verrouillage sur les fixtures canoniques phase 10', () => {
  it.each([
    ['row_2', 0.9714285714285714],
    ['span_status', 0.8],
    ['obsolete', 0.7714285714285715],
  ] as const)('%s top score stays %s', (name, score) => {
    const ranked = rank(name, HEALENIUM_PROFILE);
    expect(ranked[0]?.score).toBeCloseTo(score, 12);
    expect(ranked[0]?.score).toBe(fixtures[name].fixture.top[0]?.score);
  });

  it('replays the full canonical fixture ranking, not just the top candidate', () => {
    for (const name of ['row_2', 'span_status', 'obsolete'] as const) {
      const ranked = rank(name, HEALENIUM_PROFILE);
      const expected = fixtures[name].fixture.top.map((candidate) => candidate.score);
      expect(ranked.slice(0, expected.length).map((scored) => scored.score)).toEqual(expected);
      expect(ranked.slice(0, expected.length).map((scored) => scored.node.tag)).toEqual(
        fixtures[name].fixture.top.map((candidate) => candidate.tag),
      );
      expect(ranked.slice(0, expected.length).map((scored) => scored.node.id)).toEqual(
        fixtures[name].fixture.top.map((candidate) => candidate.id),
      );
    }
  });

  it('improved mode with every fix disabled reproduces the Healenium scores exactly', () => {
    for (const name of ['row_2', 'span_status', 'obsolete'] as const) {
      const healenium = rank(name, HEALENIUM_PROFILE);
      const baseline = rank(name, IMPROVED_BASELINE_PROFILE);
      expect(baseline.map((scored) => scored.score)).toEqual(healenium.map((scored) => scored.score));
    }
  });
});

describe('F1 — neutralité du vide (pas de points, renormalisation)', () => {
  it('C1: the empty class/other attributes stop awarding free points (and no longer mask row_two)', () => {
    const ranked = rank('row_2', F1);
    const rowOne = ranked.find((scored) => scored.node.id === 'row_1');
    const rowTwo = ranked.find((scored) => scored.node.id === 'row_two');
    expect(rowOne?.score).toBeCloseTo(270 / 280, 12);
    expect(rowTwo?.score).toBeCloseTo(258.57142857142856 / 280, 12);
    expect(ranked[0]?.node.id).toBe('row_1');
  });

  it('C2: the noise group drops, but strong.status is still below it (F1 alone)', () => {
    const ranked = rank('span_status', F1);
    expect(ranked[0]?.score).toBeCloseTo(200 / 270, 12);
    const strong = ranked.find((scored) => scored.node.tag === 'strong');
    expect(strong?.score).toBeCloseTo(170 / 270, 12);
    expect(strong?.node.classes.has('status')).toBe(true);
    const strongRank = ranked.findIndex((scored) => scored.node === strong?.node);
    expect(strongRank).toBeGreaterThan(0);
  });

  it('C3: the false positive keeps its tag/structure-only score, below the cap after renormalization', () => {
    const ranked = rank('obsolete', F1);
    expect(ranked[0]?.node.id).toBe('cancel_btn');
    expect(ranked[0]?.score).toBeCloseTo(200 / 280, 12);
  });
});

describe('F2 — position (index de frère) comme départage', () => {
  it('C1: the middle button (index 1) now outranks its look-alikes', () => {
    const ranked = rank('row_2', F1_F2);
    expect(ranked[0]?.node.id).toBe('row_two');
    expect(ranked[0]?.score).toBeCloseTo(278.57142857142856 / 300, 12);
    expect(ranked[1]?.score).toBeCloseTo(270 / 300, 12);
    expect(ranked[0]!.score - ranked[1]!.score).toBeGreaterThan(0.02);
  });

  it('never overrides an exact id match (position component not applicable)', () => {
    const reference = node({ tag: 'input', id: 'user', classes: ['x'], index: 0, text: 'Alpha' });
    const candidate = node({ tag: 'input', id: 'user', classes: ['x'], index: 2, text: 'Beta' });
    const withoutPosition = heuristicNodeDistance(reference, candidate, 4, 4, F1);
    const withPosition = heuristicNodeDistance(reference, candidate, 4, 4, F1_F2);
    expect(withPosition).toBe(withoutPosition);
    expect(withPosition).toBeCloseTo(290 / 320, 12);
  });

  it('does not make the new duplicate (#qty_b) outrank the original field (#qty_a)', () => {
    const reference = node({
      tag: 'input',
      id: 'qty_a',
      classes: ['qty'],
      index: 0,
      other: { placeholder: 'Quantity' },
    });
    const qtyA = node({
      tag: 'input',
      id: 'qty_a',
      classes: ['qty'],
      index: 1,
      other: { placeholder: 'Quantity' },
    });
    const qtyB = node({
      tag: 'input',
      id: 'qty_b',
      classes: ['qty'],
      index: 0,
      other: { placeholder: 'Quantity (copy)' },
    });
    const scoreA = heuristicNodeDistance(reference, qtyA, 7, 7, F1_F2);
    const scoreB = heuristicNodeDistance(reference, qtyB, 7, 7, F1_F2);
    expect(scoreA).toBeGreaterThan(scoreB);
    // Same id => position is not applicable and the score stays a full match.
    expect(scoreA).toBe(1);
    expect(scoreB).toBeCloseTo(316 / 340, 12);
  });
});

describe('F3 — signaux distinctifs (classe/texte exacts > balise)', () => {
  it('C2: strong.status (same class + same text) becomes the top candidate', () => {
    const ranked = rank('span_status', F1_F2_F3);
    expect(ranked[0]?.node.tag).toBe('strong');
    expect(ranked[0]?.node.classes.has('status')).toBe(true);
    // F3 grants the tag points through the exact class + text signals; everything else is a
    // full match (lcs 100, value 30, classes 40, index 20), so the candidate reaches 1.
    expect(ranked[0]?.score).toBe(1);
  });

  it('C2: a tag change is tolerated only when classes and text agree', () => {
    const reference = node({ tag: 'span', classes: ['status'], index: 0, text: 'Ready' });
    const tagChanged = node({ tag: 'strong', classes: ['status'], index: 0, text: 'Ready' });
    const sameTagNoise = node({ tag: 'span', classes: ['b'], index: 1, text: 'Should heal' });
    const changed = heuristicNodeDistance(reference, tagChanged, 7, 7, F1_F2_F3);
    const noise = heuristicNodeDistance(reference, sameTagNoise, 7, 7, F1_F2_F3);
    expect(changed).toBeGreaterThan(noise);
    expect(tagChanged.tag).not.toBe(reference.tag);
  });

  it('is inert when the flag is disabled', () => {
    const ranked = rank('span_status', F1_F2);
    expect(ranked[0]?.node.tag).toBe('span');
  });

  it('does not inflate same-tag look-alikes (F2 ordering and #qty_a are preserved)', () => {
    const ranked = rank('row_2', F1_F2_F3);
    expect(ranked[0]?.node.id).toBe('row_two');
    expect(ranked[0]?.score).toBeCloseTo(278.57142857142856 / 300, 12);
    expect(ranked[0]!.score - ranked[1]!.score).toBeGreaterThan(0.02);

    const reference = node({ tag: 'input', id: 'qty_a', classes: ['qty'], index: 0 });
    const qtyA = node({ tag: 'input', id: 'qty_a', classes: ['qty'], index: 1 });
    const qtyB = node({ tag: 'input', id: 'qty_b', classes: ['qty'], index: 0 });
    expect(heuristicNodeDistance(reference, qtyA, 7, 7, F1_F2_F3)).toBeGreaterThan(
      heuristicNodeDistance(reference, qtyB, 7, 7, F1_F2_F3),
    );
  });
});

describe('F4 — preuve minimale d’identité', () => {
  it('C3: the remaining Cancel button carries no identity signal', () => {
    const { path } = fixtures.obsolete;
    const reference = path[path.length - 1]!;
    const ranked = rank('obsolete', HEALENIUM_PROFILE);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((scored) => !hasMinimumIdentityEvidence(reference, scored.node))).toBe(true);
  });

  it('C1: the renamed middle button keeps an id similarity signal', () => {
    const { path } = fixtures.row_2;
    const reference = path[path.length - 1]!;
    const ranked = rank('row_2', HEALENIUM_PROFILE);
    const rowTwo = ranked.find((scored) => scored.node.id === 'row_two');
    expect(rowTwo).toBeDefined();
    expect(hasMinimumIdentityEvidence(reference, rowTwo!.node)).toBe(true);
  });

  it('C2: the shared class "status" is enough evidence across a tag change', () => {
    const { path } = fixtures.span_status;
    const reference = path[path.length - 1]!;
    const ranked = rank('span_status', HEALENIUM_PROFILE);
    const strong = ranked.find((scored) => scored.node.tag === 'strong');
    expect(hasMinimumIdentityEvidence(reference, strong!.node)).toBe(true);
  });

  it('accepts an unchanged / similar attribute when id, class and text carry nothing', () => {
    const reference = node({ tag: 'input', other: { name: 'email_addr' } });
    const renamed = node({ tag: 'input', other: { name: 'email' } });
    expect(hasMinimumIdentityEvidence(reference, renamed)).toBe(true);
    const unrelated = node({ tag: 'input', other: { name: 'phone' } });
    expect(hasMinimumIdentityEvidence(reference, unrelated)).toBe(false);
  });

  it('accepts the multi-change link through its shared class', () => {
    const reference = node({
      tag: 'a',
      id: 'help_link',
      classes: ['link', 'help'],
      other: { href: '#help' },
      text: 'Help',
    });
    const candidate = node({
      tag: 'a',
      id: 'support',
      classes: ['link', 'support'],
      other: { href: '#support' },
      text: 'Support',
    });
    expect(hasMinimumIdentityEvidence(reference, candidate)).toBe(true);
  });

  it('rejects tag + structure only, and does not count two empty ids as a match', () => {
    const reference = node({ tag: 'span', classes: [], text: 'Ready' });
    const candidate = node({ tag: 'span', classes: [], text: 'Something else' });
    expect(hasMinimumIdentityEvidence(reference, candidate)).toBe(false);
    expect(hasMinimumIdentityEvidence(node({}), node({}))).toBe(false);
  });
});

describe('F4b — attributs génériques (part configurable des candidats)', () => {
  const button = () => node({ tag: 'button', other: { type: 'button' } });

  it('marks a value worn by more than the ratio of distinct candidates', () => {
    const pool = [button(), button(), button(), node({ tag: 'button', other: { type: 'submit' } })];
    expect(genericAttributeValues(pool, 0.5).get('type')).toEqual(new Set(['button']));
    // 3/4 = 0.75 is not > 0.8, so the same population is not generic at 0.8.
    expect(genericAttributeValues(pool, 0.8).size).toBe(0);
  });

  it('is inert on a single candidate and disabled at ratio >= 1', () => {
    expect(genericAttributeValues([button()], 0.5).size).toBe(0);
    expect(genericAttributeValues([button(), button(), button()], 1).size).toBe(0);
  });

  it('counts distinct nodes once even when a leaf path repeats them', () => {
    const same = button();
    const pool = [same, same, button()];
    // Only two distinct candidates: 2/2 = 1 > 0.5, so the value is generic.
    expect(genericAttributeValues(pool, 0.5).get('type')).toEqual(new Set(['button']));
  });

  it('discounts a shared generic attribute in the identity check', () => {
    const reference = node({ tag: 'button', classes: [], other: { type: 'button' } });
    const candidate = node({ tag: 'button', classes: [], other: { type: 'button' } });
    expect(hasMinimumIdentityEvidence(reference, candidate)).toBe(true);
    const generic = genericAttributeValues(
      [candidate, node({ tag: 'button', other: { type: 'button' } })],
      0.5,
    );
    expect(hasMinimumIdentityEvidence(reference, candidate, undefined, { genericAttributes: generic })).toBe(
      false,
    );
  });

  it('keeps a distinctive attribute value as evidence', () => {
    const reference = node({ tag: 'input', other: { name: 'email_addr' } });
    const candidate = node({ tag: 'input', other: { name: 'email_addr' } });
    const pool = [candidate, node({ tag: 'input', other: { name: 'phone' } })];
    const generic = genericAttributeValues(pool, 0.5);
    expect(
      hasMinimumIdentityEvidence(reference, candidate, undefined, { genericAttributes: generic }),
    ).toBe(true);
  });
});

describe('F5 — refus en cas d’ambiguïté', () => {
  it('detects the four-way 0.8 tie of C2 in Healenium mode', () => {
    const ranked = rank('span_status', HEALENIUM_PROFILE);
    const ambiguity = findAmbiguity(ranked, 0.02);
    expect(ambiguity).not.toBeNull();
    expect(ambiguity?.first.node).not.toBe(ambiguity?.second.node);
  });

  it('does not flag C1 once F2 separates the middle button', () => {
    const ranked = rank('row_2', F1_F2);
    expect(findAmbiguity(ranked, 0.02)).toBeNull();
  });

  it('refuses a near-tie and honours the configured margin', () => {
    const first = { score: 0.9, node: node({ id: 'a' }) };
    const second = { score: 0.895, node: node({ id: 'b' }) };
    expect(findAmbiguity([first, second], 0.02)).not.toBeNull();
    expect(findAmbiguity([first, second], 0.004)).toBeNull();
    expect(findAmbiguity([first, second], 0)).toBeNull();
  });

  it('ignores the same node repeated by several leaf paths', () => {
    const repeated = node({ id: 'a' });
    const other = { score: 0.1, node: node({ id: 'b' }) };
    expect(findAmbiguity([{ score: 0.9, node: repeated }, { score: 0.9, node: repeated }, other], 0.02)).toBeNull();
  });
});

describe('resolveScoringProfile', () => {
  it('returns the inert Healenium profile by default', () => {
    expect(resolveScoringProfile({})).toBe(HEALENIUM_PROFILE);
    expect(resolveScoringProfile({ scoring: 'healenium', improvements: {} }).mode).toBe('healenium');
  });

  it('accepts the Healwright alias with identical scoring values', () => {
    expect(resolveScoringProfile({ scoring: 'healwright' })).toBe(HEALWRIGHT_PROFILE);
    expect(HEALWRIGHT_PROFILE).toEqual({ ...HEALENIUM_PROFILE, mode: 'healwright' });
  });

  it('defaults every fix to true in improved mode', () => {
    const profile = resolveScoringProfile({ scoring: 'improved' });
    expect(profile).toMatchObject({
      mode: 'improved',
      emptyNeutrality: true,
      positionTiebreak: true,
      distinctiveSignals: true,
      minimumEvidence: true,
      ambiguityGuard: true,
      ambiguityMargin: 0.02,
      evidenceSimilarity: 0.45,
      indexWeight: 20,
      genericAttributeRatio: 0.5,
    });
  });

  it('keeps an explicit false and honours a custom margin', () => {
    const profile = resolveScoringProfile({
      scoring: 'improved',
      improvements: { ambiguityGuard: false, ambiguityMargin: 0.1 },
    });
    expect(profile.ambiguityGuard).toBe(false);
    expect(profile.minimumEvidence).toBe(true);
    expect(profile.ambiguityMargin).toBe(0.1);
  });

  it('honours the F4 similarity and F2 index weight overrides', () => {
    const profile = resolveScoringProfile({
      scoring: 'improved',
      improvements: { evidenceSimilarity: 0.3, indexWeight: 40 },
    });
    expect(profile.evidenceSimilarity).toBe(0.3);
    expect(profile.indexWeight).toBe(40);
  });
});

describe('sweep parameters', () => {
  it('F4 threshold changes whether a weak id similarity counts as evidence', () => {
    // distance 3 on length 6: accepted at 0.45 (threshold 3), rejected at 0.3 (threshold 2).
    const reference = node({ tag: 'input', id: 'abcdef' });
    const candidate = node({ tag: 'input', id: 'abcxxx' });
    expect(hasMinimumIdentityEvidence(reference, candidate)).toBe(true);
    expect(hasMinimumIdentityEvidence(reference, candidate, 0.3)).toBe(false);
    expect(hasMinimumIdentityEvidence(reference, candidate, 0.55)).toBe(true);
  });

  it('F4 threshold also governs same-named attribute evidence', () => {
    const reference = node({ tag: 'input', other: { name: 'abcdef' } });
    const candidate = node({ tag: 'input', other: { name: 'abcxxx' } });
    expect(hasMinimumIdentityEvidence(reference, candidate, 0.3)).toBe(false);
    expect(hasMinimumIdentityEvidence(reference, candidate, 0.45)).toBe(true);
  });

  it('F2 index weight changes the position bonus only when the id is not exact', () => {
    const reference = node({ tag: 'input', id: 'a', classes: ['c'], index: 1, text: 't' });
    const candidate = node({ tag: 'input', id: 'b', classes: ['c'], index: 1, text: 't' });
    const weight20 = heuristicNodeDistance(reference, candidate, 4, 4, {
      ...F1_F2,
      indexWeight: 20,
    });
    const weight40 = heuristicNodeDistance(reference, candidate, 4, 4, {
      ...F1_F2,
      indexWeight: 40,
    });
    const weight0 = heuristicNodeDistance(reference, candidate, 4, 4, {
      ...F1_F2,
      indexWeight: 0,
    });
    expect(weight40).toBeGreaterThan(weight20);
    expect(weight20).toBeGreaterThan(weight0);
  });
});
