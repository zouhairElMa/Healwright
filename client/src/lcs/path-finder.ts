import type { Node } from '../model/node.js';
import { heuristicNodeDistance } from './node-distance.js';
import { lcsPathDistance } from './path-distance.js';
import { HEALENIUM_PROFILE } from './scoring.js';
import type { ScoringProfile } from './scoring.js';

/** Port of PathFinder (tree-comparing 0.4.14, PathFinder.java:64-161). */
export interface ScoredNode {
  score: number;
  node: Node;
}

export interface ScoresToNodes {
  pathLengthToCheck: number;
  scores: Map<number, Node[]>;
}

export function findScoresToNodes(
  path: readonly Node[],
  newSource: Node,
  profile: ScoringProfile = HEALENIUM_PROFILE,
): ScoresToNodes {
  const byPath = path[path.length - 1];
  if (byPath === undefined) {
    return { pathLengthToCheck: 0, scores: new Map() };
  }
  const pathLength = path.length;
  const destinationLeaves = findAllLeafPaths(newSource);

  const paths: { nodes: Node[]; distance: number }[] = [];
  let maxLCSDistance = 0;
  for (const leaf of destinationLeaves) {
    const distance = lcsPathDistance(path, leaf);
    if (distance < 1) {
      continue;
    }
    maxLCSDistance = Math.max(maxLCSDistance, distance);
    paths.push({ nodes: leaf, distance });
  }

  const pathLengthToCheck = Math.min(maxLCSDistance, pathLength);
  const scores = new Map<number, Node[]>();
  for (const { nodes, distance } of paths) {
    for (const node of nodes.slice(distance - 1)) {
      const score = heuristicNodeDistance(byPath, node, distance, pathLengthToCheck, profile);
      const group = scores.get(score);
      if (group === undefined) {
        scores.set(score, [node]);
      } else {
        group.push(node);
      }
    }
  }
  return { pathLengthToCheck, scores };
}

export function getSortedNodes(
  scores: Map<number, Node[]>,
  bestGuessesCount: number,
  guessCap: number,
): ScoredNode[] {
  const nodeLimit = bestGuessesCount < 0 ? 1 : bestGuessesCount;
  const scoreLimit = guessCap > 1 ? -1 : guessCap;
  const keys = [...scores.keys()].sort((a, b) => b - a);
  const result: ScoredNode[] = [];
  for (const score of keys) {
    if (score < scoreLimit) {
      continue;
    }
    for (const node of scores.get(score)!) {
      if (result.length >= nodeLimit) {
        return result;
      }
      result.push({ score, node });
    }
  }
  return result;
}

export function find(
  path: readonly Node[],
  newSource: Node,
  bestGuessesCount: number,
  profile: ScoringProfile = HEALENIUM_PROFILE,
): ScoredNode[] {
  return getSortedNodes(findScoresToNodes(path, newSource, profile).scores, bestGuessesCount, -1);
}

export function findNearest(
  path: readonly Node[],
  newSource: Node,
  profile: ScoringProfile = HEALENIUM_PROFILE,
): Node | null {
  const found = find(path, newSource, 1, profile);
  return found.length === 0 ? null : found[0]!.node;
}

/**
 * Java uses ArrayDeque.addFirst + removeLast (PathFinder.java:118-133), i.e. a FIFO
 * queue: breadth-first, children in document order. The queue + head index reproduces
 * that ordering, which breaks ties within an equal-score group.
 */
function findAllLeafPaths(root: Node): Node[][] {
  const leaves: Node[][] = [];
  const queue: Node[][] = [[root]];
  let head = 0;
  while (head < queue.length) {
    const path = queue[head++]!;
    const node = path[path.length - 1]!;
    if (node.children.length === 0) {
      leaves.push(path);
    } else {
      for (const child of node.children) {
        queue.push([...path, child]);
      }
    }
  }
  return leaves;
}