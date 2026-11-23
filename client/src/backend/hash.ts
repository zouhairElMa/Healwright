import { createHash } from 'node:crypto';
import { javaTrim } from '../utils/java-string.js';

/**
 * JVM String.hashCode(): 31-polynomial over UTF-16 code units, signed 32-bit.
 * charCodeAt iterates UTF-16 units exactly like Java's char-based loop (surrogate
 * pairs included), so emoji/non-BMP strings match the JVM.
 */
export function javaHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function md5Hex(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex');
}

/** selectorId = md5((url + command + locator.hashCode()).trim()) — healenium Utils.buildKey (phase-1 §7.2). */
export function buildSelectorId(locator: string, command: string, url: string): string {
  return md5Hex(javaTrim(`${url}${command}${javaHashCode(locator)}`));
}

/** healingId = md5((elementId + pageSource.hashCode()).trim()) — Utils.buildHealingKey (phase-1 §7.2). */
export function buildHealingId(elementId: string, pageSource: string): string {
  return md5Hex(javaTrim(`${elementId}${javaHashCode(pageSource)}`));
}