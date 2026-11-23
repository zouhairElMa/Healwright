import type { Node } from '../model/node.js';

/**
 * Port of LCSPathDistance.lcs (tree-comparing 0.4.14, LCSPathDistance.java:14-31).
 * Longest common subsequence over Node.equals (tag + id, case-sensitive).
 */
export function lcsPathDistance(path1: readonly Node[], path2: readonly Node[]): number {
  const m = path1.length;
  const n = path2.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const row = table[i]!;
      const prevRow = table[i - 1]!;
      if (path1[i - 1]!.equals(path2[j - 1]!)) {
        row[j] = prevRow[j - 1]! + 1;
      } else {
        row[j] = Math.max(prevRow[j]!, row[j - 1]!);
      }
    }
  }
  return table[m]![n]!;
}