/**
 * Port of HeuristicNodeDistance.calculateLevenshteinScore (tree-comparing, phase-1 §6.4).
 * commons-text LevenshteinDistance(threshold) returns -1 when distance > threshold;
 * equivalently we compute the full distance and reject it when it exceeds the threshold.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

function isBoolean(value: string): boolean {
  return value === 'true' || value === 'false';
}

export function calculateLevenshteinScore(
  a: string | null | undefined,
  b: string | null | undefined,
  thresholdPercent: number,
): number {
  if (a == null || b == null) return 0;
  a = a.toLowerCase();
  b = b.toLowerCase();
  const length = Math.max(a.length, b.length);
  if (length === 0) return 1;
  if (isBoolean(a) || isBoolean(b)) return a === b ? 1 : 0;
  const threshold = Math.trunc(length * thresholdPercent + 1);
  const distance = levenshteinDistance(a, b);
  if (distance > threshold) return 0;
  return (length - distance) / length;
}