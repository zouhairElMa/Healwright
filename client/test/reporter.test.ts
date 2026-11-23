/**
 * Phase-8 local reporter: JSONL telemetry must be written best-effort (one line per event,
 * session file named after the report uid) and must never throw, whatever the filesystem does.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LocalReporter, nullReporter, defaultReportDir, reportRegistryFile } from '../src/report/reporter.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'hw-report-'));
}

/** Keeps the shared discovery registry out of the developer's home directory. */
const sandbox = mkdtempSync(join(tmpdir(), 'hw-registry-'));
process.env['HEALWRIGHT_REPORT_REGISTRY'] = join(sandbox, 'dirs.json');
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function readRegistry(): { dirs?: string[] } | null {
  try {
    return JSON.parse(readFileSync(reportRegistryFile(), 'utf8')) as { dirs?: string[] };
  } catch {
    return null;
  }
}

/** Polls instead of sleeping: JSONL writes are fire-and-forget by design. */
async function until<T>(probe: () => T | null, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('condition not met within timeout');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function readLines(file: string): string[] | null {
  try {
    const content = readFileSync(file, 'utf8').trim();
    return content.length > 0 ? content.split('\n') : null;
  } catch {
    return null;
  }
}

describe('LocalReporter', () => {
  it('appends one JSON line per event to <dir>/<sessionId>.jsonl', async () => {
    const dir = tempDir();
    try {
      const reporter = new LocalReporter({ sessionId: 'sess-1', dir });
      reporter.record({ event: 'report.opening', serverUrl: 'http://localhost:7878' });
      reporter.record({ event: 'heal.success', score: 0.98 });
      const lines = await until(() => {
        const current = readLines(resolve(dir, 'sess-1.jsonl'));
        return current !== null && current.length >= 2 ? current : null;
      });
      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]!) as Record<string, unknown>;
      const second = JSON.parse(lines[1]!) as Record<string, unknown>;
      expect(first.event).toBe('report.opening');
      expect(first.sessionId).toBe('sess-1');
      expect(typeof first.ts).toBe('string');
      expect(second.event).toBe('heal.success');
      expect(second.score).toBe(0.98);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists the Playwright test name and file in report.meta (Phase-17)', async () => {
    const dir = tempDir();
    try {
      const reporter = new LocalReporter({ sessionId: 'sess-meta', dir });
      reporter.record({ event: 'report.meta', testName: 'Login › heals the submit button', testFile: '/tests/login.spec.ts' });
      const lines = await until(() => {
        const current = readLines(resolve(dir, 'sess-meta.jsonl'));
        return current !== null && current.length >= 1 ? current : null;
      });
      const meta = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(meta.event).toBe('report.meta');
      expect(meta.testName).toBe('Login › heals the submit button');
      expect(meta.testFile).toBe('/tests/login.spec.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the report directory lazily', async () => {
    const dir = join(tempDir(), 'nested', 'reports');
    try {
      const reporter = new LocalReporter({ sessionId: 'sess-2', dir });
      reporter.record({ event: 'report.opening' });
      const content = await until(() => {
        const current = readLines(resolve(dir, 'sess-2.jsonl'));
        return current !== null && current.some((l) => l.includes('report.opening'))
          ? readFileSync(resolve(dir, 'sess-2.jsonl'), 'utf8')
          : null;
      });
      expect(content).toContain('report.opening');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('nullReporter swallows everything', () => {
    expect(() => nullReporter.record({ event: 'anything' })).not.toThrow();
  });

  it('defaultReportDir lives under <cwd>/.healwright/reports', () => {
    expect(defaultReportDir()).toBe(resolve(process.cwd(), '.healwright', 'reports'));
  });

  it('registers its absolute dir so the backend can discover the telemetry', async () => {
    const dir = tempDir();
    try {
      const reporter = new LocalReporter({ sessionId: 'sess-registry', dir });
      reporter.record({ event: 'report.opening' });
      const registry = await until(() => {
        const current = readRegistry();
        return current?.dirs?.includes(resolve(dir)) ? current : null;
      });
      expect(registry.dirs?.[0]).toBe(resolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges with existing registry entries, newest first, without duplicates', async () => {
    const older = tempDir();
    const newer = tempDir();
    try {
      mkdirSync(join(sandbox), { recursive: true });
      writeFileSync(reportRegistryFile(), JSON.stringify({ dirs: [resolve(older)] }), 'utf8');
      new LocalReporter({ sessionId: 'sess-merge', dir: newer });
      const registry = await until(() => {
        const current = readRegistry();
        return current?.dirs?.includes(resolve(newer)) ? current : null;
      });
      expect(registry.dirs?.[0]).toBe(resolve(newer));
      expect(registry.dirs).toContain(resolve(older));
      expect(new Set(registry.dirs).size).toBe(registry.dirs?.length);
    } finally {
      rmSync(older, { recursive: true, force: true });
      rmSync(newer, { recursive: true, force: true });
    }
  });

  it('rewrites a malformed registry instead of failing the run', async () => {
    const dir = tempDir();
    try {
      mkdirSync(sandbox, { recursive: true });
      writeFileSync(reportRegistryFile(), 'not json at all', 'utf8');
      new LocalReporter({ sessionId: 'sess-bad-registry', dir });
      const registry = await until(() => {
        const current = readRegistry();
        return current?.dirs?.includes(resolve(dir)) ? current : null;
      });
      expect(registry.dirs?.[0]).toBe(resolve(dir));
      expect(registry.dirs).not.toContain('not json at all');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
