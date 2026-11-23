#!/usr/bin/env node
// Runs the Healwright backend jar directly and waits until it is healthy.
// Dependency-free (Node builtins only) so it works straight from the package.
//
// Usage:
//   node scripts/run-backend.mjs [--jar <path>] [--port <n>] [--db-host <h>] [--db-port <n>]
// Env:
//   HEALWRIGHT_BACKEND_JAR  path to a healenium-backend-*.jar or healwright-backend-*.jar (overrides discovery)
//   Any SPRING_* variable is passed through to the backend.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--jar') out.jar = argv[(i += 1)];
    else if (a === '--port') out.port = argv[(i += 1)];
    else if (a === '--db-host') out.dbHost = argv[(i += 1)];
    else if (a === '--db-port') out.dbPort = argv[(i += 1)];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(
    'Usage: node scripts/run-backend.mjs [--jar <path>] [--port <n>] [--db-host <h>] [--db-port <n>]\n',
  );
  process.exit(0);
}

function findIn(dir) {
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const jar = entries
    .filter((f) => /^(healenium|healwright)-backend-.*\.jar$/.test(f))
    .sort((a, b) => Number(b.startsWith('healwright-backend-')) - Number(a.startsWith('healwright-backend-')))[0];
  return jar ? join(dir, jar) : null;
}

function discoverJar() {
  // An explicit path must exist; never silently fall through to another jar.
  const explicit = args.jar ?? process.env.HEALWRIGHT_BACKEND_JAR;
  if (explicit) {
    return existsSync(explicit) ? resolve(explicit) : { missing: resolve(explicit) };
  }
  const candidates = [
    findIn(resolve(process.cwd())),
    findIn(resolve(process.cwd(), 'build/libs')),
    // Public repository layout first; source-workspace fallbacks remain for local development.
    findIn(resolve(scriptDir, '../../backend/build/libs')),
    findIn(resolve(scriptDir, '../../sources/healwright-backend/build/libs')),
    findIn(resolve(scriptDir, '../../sources/healenium-backend/build/libs')),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return resolve(c);
  }
  return null;
}

const found = discoverJar();
if (found && typeof found === 'object' && found.missing) {
  process.stderr.write(`[run-backend] jar not found at the explicit path: ${found.missing}\n`);
  process.exit(2);
}
const jar = typeof found === 'string' ? found : null;
if (!jar) {
  process.stderr.write(
    [
      'Could not locate the Healwright backend jar.',
      '',
      'Use the jar from the Healwright production distribution with either:',
      '  --jar /path/to/healwright-backend-3.5.1.jar',
      '  HEALWRIGHT_BACKEND_JAR=/path/to/healwright-backend-3.5.1.jar',
      '',
      'See docs/backend.md in the Healwright repository.',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

const port = args.port ?? process.env.SPRING_SERVER_PORT ?? '7878';
const env = {
  ...process.env,
  SPRING_SERVER_PORT: String(port),
  COLLECT_METRICS: process.env.COLLECT_METRICS ?? 'false',
  // The jar's child cwd is dirname(jar); anchor the embedded dashboard's telemetry dir
  // to the caller's cwd so it reads the same .healwright/reports Healwright writes to.
  HEALWRIGHT_REPORT_DIR:
    process.env.HEALWRIGHT_REPORT_DIR ?? resolve(process.cwd(), '.healwright', 'reports'),
};
if (args.dbHost) env.SPRING_POSTGRES_DB_HOST = args.dbHost;
if (args.dbPort) env.SPRING_POSTGRES_DB_PORT = args.dbPort;

process.stdout.write(`[run-backend] jar  = ${jar}\n`);
process.stdout.write(`[run-backend] port = ${port}\n`);
process.stdout.write('[run-backend] starting java -jar (Ctrl-C to stop)...\n');

const child = spawn('java', ['-jar', jar], {
  cwd: dirname(jar),
  env,
  stdio: 'inherit',
});

let settled = false;
child.on('exit', (code, signal) => {
  if (!settled) {
    process.stderr.write(`[run-backend] backend exited early (code=${code} signal=${signal}).\n`);
  }
  process.exit(code ?? 1);
});

function checkHealth() {
  return new Promise((res) => {
    const req = httpGet({ host: '127.0.0.1', port: Number(port), path: '/actuator/health', timeout: 2000 }, (r) => {
      r.resume();
      res(r.statusCode === 200);
    });
    req.on('error', () => res(false));
    req.on('timeout', () => {
      req.destroy();
      res(false);
    });
  });
}

// The all-in-one jar (phase 18) serves the dashboard at "/"; older builds answered on
// /healwright/ only. Upstream jars embed nothing and the Node dashboard is the fallback.
function checkEmbeddedDashboard() {
  const probe = (path) => new Promise((res) => {
    const req = httpGet({ host: '127.0.0.1', port: Number(port), path, timeout: 2000 }, (r) => {
      r.resume();
      res(r.statusCode === 200);
    });
    req.on('error', () => res(false));
    req.on('timeout', () => {
      req.destroy();
      res(false);
    });
  });
  return probe('/api/config').then((ok) => (ok ? true : probe('/healwright/api/config')));
}

const deadline = Date.now() + 90_000;
const poll = setInterval(async () => {
  if (await checkHealth()) {
    settled = true;
    clearInterval(poll);
    const embedded = await checkEmbeddedDashboard();
    process.stdout.write(
      [
        '',
        `[run-backend] backend is UP on http://localhost:${port}`,
        embedded
          ? `[run-backend] embedded dashboard: http://localhost:${port}/`
          : '[run-backend] dashboard (jar without embedded reporting): npx healwright-report',
        `[run-backend] use it from Playwright:  heal(page, { serverUrl: 'http://localhost:${port}', ... })`,
        '',
      ].join('\n'),
    );
  } else if (Date.now() > deadline) {
    clearInterval(poll);
    process.stderr.write('[run-backend] health check timed out after 90s. Is PostgreSQL running?\n');
  }
}, 1500);
