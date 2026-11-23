/**
 * Phase-8 local reporting telemetry. The Healwright backend persists report records
 * (failed/healed locator, score, screenshot, success flag) but drops everything Healwright
 * knows beyond that: candidate lists, LCS timings, replay method and outcome. This reporter
 * appends those events as JSONL — one file per session, named after the report uid — so the
 * Healwright dashboard can show a richer view than the legacy Thymeleaf report page.
 *
 * Writes are fire-and-forget and never throw: reporting must not fail a test run.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { silentLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface TelemetrySink {
  record(fields: Record<string, unknown>): void;
  /** Await pending appends (phase 24: auto rewrite reads the file back through the backend). */
  flush?: () => Promise<void>;
}

export const nullReporter: TelemetrySink = { record(): void {} };

export interface LocalReporterOptions {
  sessionId: string;
  /** Defaults to <cwd>/.healwright/reports. */
  dir?: string;
  logger?: Logger;
}

export function defaultReportDir(): string {
  return resolve(process.cwd(), '.healwright', 'reports');
}

/**
 * Discovery registry shared with the backend/dashboard: the test process knows exactly where
 * it writes, the backend does not (its cwd/env are unrelated). Registering the absolute dir on
 * the first session lets the jar find any project's telemetry without matching env vars.
 * Override the file with HEALWRIGHT_REPORT_REGISTRY (tests, sandboxes).
 */
export function reportRegistryFile(): string {
  const env = process.env['HEALWRIGHT_REPORT_REGISTRY'];
  return resolve(env && env.trim().length > 0 ? env : join(homedir(), '.healwright', 'dirs.json'));
}

const REGISTRY_MAX_DIRS = 20;
const registeredDirs = new Set<string>();

async function registerReportDir(dir: string): Promise<void> {
  const abs = resolve(dir);
  if (registeredDirs.has(abs)) {
    return;
  }
  registeredDirs.add(abs);
  const file = reportRegistryFile();
  try {
    let dirs: string[] = [];
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { dirs?: unknown };
      if (Array.isArray(raw.dirs)) {
        dirs = raw.dirs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      }
    } catch {
      // Missing or malformed registry: rewritten below.
    }
    const merged = [abs, ...dirs.filter((entry) => resolve(entry) !== abs)].slice(0, REGISTRY_MAX_DIRS);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ dirs: merged }, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  } catch {
    // Discovery is best-effort: never fail a test run over it.
  }
}

export class LocalReporter implements TelemetrySink {
  readonly sessionId: string;
  readonly filePath: string;
  private readonly logger: Logger;
  private dirReady: Promise<void> | null = null;
  // Serializes writes so JSONL line order always matches record() call order.
  private queue: Promise<void> = Promise.resolve();

  constructor(options: LocalReporterOptions) {
    const dir = resolve(options.dir ?? defaultReportDir());
    this.sessionId = options.sessionId;
    this.filePath = resolve(dir, `${this.sessionId}.jsonl`);
    this.logger = options.logger ?? silentLogger;
    void registerReportDir(dir);
  }

  record(fields: Record<string, unknown>): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      ...fields,
    });
    this.queue = this.queue.then(() => this.append(line));
  }

  async flush(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  private async append(line: string): Promise<void> {
    try {
      if (this.dirReady === null) {
        const dir = resolve(this.filePath, '..');
        this.dirReady = mkdir(dir, { recursive: true }).then(() => undefined);
      }
      await this.dirReady;
      await appendFile(this.filePath, `${line}\n`, 'utf8');
    } catch (e) {
      this.logger.warn('[Report] Telemetry write failed: {}', e instanceof Error ? e.message : String(e));
    }
  }
}
