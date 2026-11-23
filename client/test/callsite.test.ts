import { describe, expect, it } from 'vitest';
import { captureCallsite } from '../src/playwright/callsite.js';
import { withFrame, withStep } from '../src/playwright/expression.js';

describe('phase-24 source callsite', () => {
  it('captures the calling test file and its line', () => {
    const at = captureCallsite();
    expect(at).not.toBeNull();
    expect(at!.file.endsWith('callsite.test.ts')).toBe(true);
    expect(at!.line).toBeGreaterThan(0);
    expect(at!.column).toBeGreaterThan(0);
  });

  it('keeps the callsite across every chain step', () => {
    const callsite = { file: '/tmp/example.spec.ts', line: 12, column: 5 };
    const start = {
      value: "page.locator('#a')",
      root: 'page',
      apis: ['locator'],
      callsite,
    };
    const chained = withStep(start, 'getByRole', ['button', { name: 'Save' }]);
    expect(chained.callsite).toEqual(callsite);
    expect(chained.value).toContain('getByRole');
  });

  it('carries the callsite into a frame expression', () => {
    const callsite = { file: '/tmp/frame.spec.ts', line: 3, column: 9 };
    const frame = withFrame('page', '#frame', callsite);
    expect(frame.callsite).toEqual(callsite);
    expect(frame.apis).toEqual(['frameLocator']);
  });
});
