import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  javaHashCode,
  md5Hex,
  buildSelectorId,
  buildHealingId,
} from '../src/backend/hash.js';

interface Vectors {
  hashCode: Record<string, number>;
  buildKey: { locator: string; command: string; url: string; selectorId: string }[];
  buildHealingKey: { elementId: string; pageSource: string; healingId: string }[];
}

const vectors = JSON.parse(
  readFileSync(new URL('./vectors/java-vectors.json', import.meta.url), 'utf8'),
) as Vectors;

describe('javaHashCode — JVM String.hashCode parity', () => {
  for (const [value, expected] of Object.entries(vectors.hashCode)) {
    it(`hashCode(${JSON.stringify(value)}) === ${expected}`, () => {
      expect(javaHashCode(value)).toBe(expected);
    });
  }
});

describe('buildSelectorId — Utils.buildKey parity', () => {
  for (const v of vectors.buildKey) {
    it(`${JSON.stringify(v.locator)} / ${v.command} / ${JSON.stringify(v.url)}`, () => {
      expect(buildSelectorId(v.locator, v.command, v.url)).toBe(v.selectorId);
    });
  }
});

describe('buildHealingId — Utils.buildHealingKey parity', () => {
  for (const v of vectors.buildHealingKey) {
    it(`elementId=${JSON.stringify(v.elementId)}`, () => {
      expect(buildHealingId(v.elementId, v.pageSource)).toBe(v.healingId);
    });
  }
});

describe('md5Hex', () => {
  it('matches the known MD5 of the empty string', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});