import type { Node } from '../model/node.js';
import { calculateLevenshteinScore } from './levenshtein.js';
import { difference, intersect, union } from './sets.js';
import { HEALENIUM_PROFILE, normalizedText } from './scoring.js';
import type { ScoringProfile } from './scoring.js';

/**
 * Port of HeuristicNodeDistance (tree-comparing 0.4.14, HeuristicNodeDistance.java:11-96).
 * Weights: TAG 100, LCS 100, ID 50, CLASS 40, VALUE 30, INDEX 0, OTHER 30; normalized by 350.
 *
 * The default profile is 'healenium', so this function keeps the upstream formula untouched.
 * The 'improved' profile (phase-12, F1..F3) is a separate path selected by ScoringProfile.
 */
const POINTS_FOR_TAG = 100;
const POINTS_FOR_LCS = 100;
const POINTS_FOR_ID = 50;
const POINTS_FOR_CLASS = 40;
const POINTS_FOR_VALUE = 30;
const POINTS_FOR_OTHER_ATTRIBUTE = 30;
const MAXIMUM_SCORE =
  POINTS_FOR_TAG +
  POINTS_FOR_ID +
  POINTS_FOR_VALUE +
  POINTS_FOR_LCS +
  POINTS_FOR_CLASS +
  POINTS_FOR_OTHER_ATTRIBUTE;

export function heuristicNodeDistance(
  node1: Node,
  node2: Node,
  lcsDistance: number,
  curPathHeight: number,
  profile: ScoringProfile = HEALENIUM_PROFILE,
): number {
  if (curPathHeight === 0 || (curPathHeight > 5 && lcsDistance / curPathHeight < 0.7)) {
    return 0;
  }
  if (profile.mode === 'improved') {
    return improvedNodeDistance(node1, node2, lcsDistance, curPathHeight, profile);
  }
  let score = (lcsDistance / curPathHeight) * POINTS_FOR_LCS;

  const propertyNames = union(
    new Set(node1.otherAttributes.keys()),
    new Set(node2.otherAttributes.keys()),
  );
  const classNames = union(node1.classes, node2.classes);

  if (node1.tag.toLowerCase() === node2.tag.toLowerCase()) {
    score += POINTS_FOR_TAG;
  }
  // POINTS_FOR_INDEX is 0 (HeuristicNodeDistance.java:16), so index equality adds nothing.
  // TS Node.id/innerText are always strings (capture uses "" when absent), so the Java
  // null guards (lines 45, 114) never short-circuit here.
  score += POINTS_FOR_ID * calculateLevenshteinScore(node1.id, node2.id, 0.3);
  score += POINTS_FOR_VALUE * calculateLevenshteinScore(node1.innerText, node2.innerText, 0.3);

  const classesIntersect = intersect(node1.classes, node2.classes);
  if (classNames.size > 0) {
    score += (classesIntersect.size * POINTS_FOR_CLASS) / classNames.size;
  } else {
    score += POINTS_FOR_CLASS;
  }

  const node1ClassesDifference = difference(node1.classes, node2.classes);
  const node2ClassesDifference = difference(node2.classes, node1.classes);
  const lengthDifference = union(node1ClassesDifference, node2ClassesDifference).size;
  if (lengthDifference > 0) {
    let classesScore =
      node1ClassesDifference.size > 0
        ? averageLevenshtein(node1ClassesDifference, node2.classes, 0.75)
        : averageLevenshtein(node1.classes, node2ClassesDifference, 0.75);
    if (classNames.size > 0) {
      classesScore /= classNames.size;
    }
    score += lengthDifference * POINTS_FOR_CLASS * classesScore;
  }

  if (propertyNames.size > 0) {
    let otherAttributesScore = 0;
    for (const propertyName of propertyNames) {
      otherAttributesScore +=
        POINTS_FOR_OTHER_ATTRIBUTE *
        calculateLevenshteinScore(
          node1.otherAttributes.get(propertyName),
          node2.otherAttributes.get(propertyName),
          0.75,
        );
    }
    score += otherAttributesScore / propertyNames.size;
  } else {
    score += POINTS_FOR_OTHER_ATTRIBUTE;
  }

  return score / MAXIMUM_SCORE;
}

/**
 * Improved formula: same component values as Healenium, but
 * - F1: components absent on both sides are removed from the numerator AND the maximum
 *       (no free points, renormalized on what is attainable);
 * - F2: sibling index equality adds profile.indexWeight (default 20) when the id does not already
 *       match;
 * - F3: an exact class set or an exact text grants the TAG points even when the tag changed,
 *       i.e. distinctive signals can substitute for tag equality (a tag change is tolerated
 *       only when they agree).
 * A perfect match still tops out at 1 (the result is clamped).
 */
function improvedNodeDistance(
  reference: Node,
  candidate: Node,
  lcsDistance: number,
  curPathHeight: number,
  profile: ScoringProfile,
): number {
  const classNames = union(reference.classes, candidate.classes);
  const propertyNames = union(
    new Set(reference.otherAttributes.keys()),
    new Set(candidate.otherAttributes.keys()),
  );
  const classesIntersect = intersect(reference.classes, candidate.classes);
  const exactClasses = classNames.size > 0 && classesIntersect.size === classNames.size;
  const referenceText = normalizedText(reference.innerText);
  const exactText = referenceText !== '' && referenceText === normalizedText(candidate.innerText);

  // F1: "absent on both sides" means the pair carries no information for that attribute.
  const idApplicable = !profile.emptyNeutrality || reference.id !== '' || candidate.id !== '';
  const valueApplicable =
    !profile.emptyNeutrality || reference.innerText !== '' || candidate.innerText !== '';
  const classesApplicable = !profile.emptyNeutrality || classNames.size > 0;
  const otherApplicable = !profile.emptyNeutrality || propertyNames.size > 0;
  // F2 is only informative when the id did not already identify the element.
  const indexApplicable =
    profile.positionTiebreak && !(reference.id !== '' && reference.id === candidate.id);

  let score = (lcsDistance / curPathHeight) * POINTS_FOR_LCS;
  let maximum = POINTS_FOR_TAG + POINTS_FOR_LCS;

  const tagMatches = reference.tag.toLowerCase() === candidate.tag.toLowerCase();
  const distinctiveSignals = profile.distinctiveSignals && (exactClasses || exactText);
  if (tagMatches || distinctiveSignals) {
    score += POINTS_FOR_TAG;
  }

  if (idApplicable) {
    maximum += POINTS_FOR_ID;
    score += POINTS_FOR_ID * calculateLevenshteinScore(reference.id, candidate.id, 0.3);
  }

  if (valueApplicable) {
    maximum += POINTS_FOR_VALUE;
    score += POINTS_FOR_VALUE * calculateLevenshteinScore(reference.innerText, candidate.innerText, 0.3);
  }

  if (classesApplicable) {
    maximum += POINTS_FOR_CLASS;
    score += classPoints(reference, candidate, classNames, classesIntersect);
  }

  if (otherApplicable) {
    maximum += POINTS_FOR_OTHER_ATTRIBUTE;
    if (propertyNames.size > 0) {
      let otherAttributesScore = 0;
      for (const propertyName of propertyNames) {
        otherAttributesScore +=
          POINTS_FOR_OTHER_ATTRIBUTE *
          calculateLevenshteinScore(
            reference.otherAttributes.get(propertyName),
            candidate.otherAttributes.get(propertyName),
            0.75,
          );
      }
      score += otherAttributesScore / propertyNames.size;
    } else {
      score += POINTS_FOR_OTHER_ATTRIBUTE;
    }
  }

  if (indexApplicable) {
    maximum += profile.indexWeight;
    if (reference.index === candidate.index) {
      score += profile.indexWeight;
    }
  }

  return Math.min(1, score / maximum);
}

/** Intersection minus difference term, same arithmetic as the Healenium path (max 40). */
function classPoints(
  reference: Node,
  candidate: Node,
  classNames: Set<string>,
  classesIntersect: Set<string>,
): number {
  let score = 0;
  if (classNames.size > 0) {
    score += (classesIntersect.size * POINTS_FOR_CLASS) / classNames.size;
  } else {
    score += POINTS_FOR_CLASS;
  }
  const referenceDifference = difference(reference.classes, candidate.classes);
  const candidateDifference = difference(candidate.classes, reference.classes);
  const lengthDifference = union(referenceDifference, candidateDifference).size;
  if (lengthDifference > 0) {
    let classesScore =
      referenceDifference.size > 0
        ? averageLevenshtein(referenceDifference, candidate.classes, 0.75)
        : averageLevenshtein(reference.classes, candidateDifference, 0.75);
    if (classNames.size > 0) {
      classesScore /= classNames.size;
    }
    score += lengthDifference * POINTS_FOR_CLASS * classesScore;
  }
  return score;
}

function averageLevenshtein(
  classes1: Set<string>,
  classes2: Set<string>,
  thresholdPercent: number,
): number {
  let comparisonsNumber = 0;
  let scores = 0;
  for (const first of classes1) {
    for (const second of classes2) {
      scores += calculateLevenshteinScore(first, second, thresholdPercent);
      comparisonsNumber += 1;
    }
  }
  return comparisonsNumber === 0 ? 0 : scores / comparisonsNumber;
}
