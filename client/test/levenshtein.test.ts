import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateLevenshteinScore, levenshteinDistance } from '../src/lcs/levenshtein.js';

interface LevenshteinVector {
  a: string;
  b: string;
  p: number;
  score: number;
}
const vectors = JSON.parse(
  readFileSync(new URL('./vectors/lcs-vectors.json', import.meta.url), 'utf8'),
) as { levenshtein: LevenshteinVector[] };

describe('calculateLevenshteinScore (JVM parity)', () => {
  it.each(vectors.levenshtein)('$a vs $b (p=$p) = $score', ({ a, b, p, score }) => {
    expect(calculateLevenshteinScore(a, b, p)).toBeCloseTo(score, 10);
  });

  it('returns 0 when either side is null/undefined', () => {
    expect(calculateLevenshteinScore(null, 'x', 0.3)).toBe(0);
    expect(calculateLevenshteinScore('x', undefined, 0.3)).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(calculateLevenshteinScore('ABC', 'abc', 0.3)).toBe(1);
  });

  it('treats boolean strings specially after lowercasing', () => {
    expect(calculateLevenshteinScore('TRUE', 'true', 0.3)).toBe(1);
    expect(calculateLevenshteinScore('true', 'false', 0.3)).toBe(0);
  });
});

describe('levenshteinDistance', () => {
  it('computes classic edit distances', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
    expect(levenshteinDistance('', '')).toBe(0);
  });
});