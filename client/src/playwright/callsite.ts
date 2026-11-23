/**
 * Phase-24: remember where the test wrote a locator chain, so a healed locator can be written
 * back to that exact source line. Playwright's TypeScript loader preserves original file names
 * and line numbers in stack traces (verified 2026-11-15: a test at tests/x.spec.ts:4 reports
 * "at file:///.../tests/x.spec.ts:4:17"), so the first frame outside this package and outside
 * node_modules is the user call site.
 *
 * Display-only until a rewrite is explicitly requested: the healing key and decisions are
 * unchanged. A missing call site (unusual loader, eval) simply disables the write-back offer.
 */
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export interface SourceLocation {
  /** Absolute path as reported by the runtime. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column; a hint only (transpilers may shift columns but keep lines). */
  column: number;
}

/** Directory of this module: its own frames (wrapper, engine, ...) are never user code. */
const SELF_DIR = dirname(fileURLToPath(import.meta.url));

// "    at fn (file:///a/b.ts:3:9)" and "    at file:///a/b.ts:3:9" (anonymous).
const STACK_FRAME = /^\s*at\s+(?:.*?\s+\()?([^()]+?):(\d+):(\d+)\)?$/;

function toPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('file://')) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }
  // Windows drive letters and POSIX absolute paths only; reject node:, eval, <anonymous>.
  return /^([A-Za-z]:[\\/]|\/)/.test(trimmed) ? trimmed : null;
}

export function captureCallsite(): SourceLocation | null {
  const stack = new Error().stack;
  if (stack === undefined) {
    return null;
  }
  for (const frame of stack.split('\n').slice(1)) {
    const match = STACK_FRAME.exec(frame);
    if (match === null) {
      continue;
    }
    const file = toPath(match[1] ?? '');
    if (file === null) {
      continue;
    }
    if (file.includes(`${dirSep()}node_modules${dirSep()}`) || file.startsWith(SELF_DIR + dirSep())) {
      continue;
    }
    return { file, line: Number(match[2]), column: Number(match[3]) };
  }
  return null;
}

function dirSep(): string {
  return process.platform === 'win32' ? '\\' : '/';
}
