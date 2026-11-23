#!/usr/bin/env node
// One-command readiness check for a Healwright + Playwright stack.
// Verifies Node, Java, PostgreSQL, the Healwright backend, and (optionally) the
// local test-env used by the validation suite. Dependency-free (Node builtins).
//
// Usage:
//   node scripts/doctor.mjs [--backend <url>] [--db-host <h>] [--db-port <n>] [--test-env <url>]
// Env:
//   HEALWRIGHT_SERVER_URL  backend base url (default http://localhost:7878)

import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { get as httpGet } from 'node:http';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--backend') out.backend = argv[(i += 1)];
    else if (a === '--db-host') out.dbHost = argv[(i += 1)];
    else if (a === '--db-port') out.dbPort = argv[(i += 1)];
    else if (a === '--test-env') out.testEnv = argv[(i += 1)];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const backendUrl = args.backend ?? process.env.HEALWRIGHT_SERVER_URL ?? 'http://localhost:7878';
const dbHost = args.dbHost ?? process.env.SPRING_POSTGRES_DB_HOST ?? 'localhost';
const dbPort = Number(args.dbPort ?? process.env.SPRING_POSTGRES_DB_PORT ?? '5432');
const testEnvUrl = args.testEnv ?? 'http://127.0.0.1:8099/index.html';

const rows = [];
function record(name, status, detail) {
  rows.push({ name, status, detail });
}

function tcpOpen(host, port, timeoutMs = 2000) {
  return new Promise((res) => {
    const sock = connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      res(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

function httpStatus(url, timeoutMs = 3000) {
  return new Promise((res) => {
    const req = httpGet(url, { timeout: timeoutMs }, (r) => {
      r.resume();
      res(r.statusCode ?? 0);
    });
    req.on('error', () => res(0));
    req.on('timeout', () => {
      req.destroy();
      res(0);
    });
  });
}

const major = Number(process.versions.node.split('.')[0]);
record('Node', major >= 20 ? 'PASS' : 'FAIL', `v${process.versions.node} (need >=20)`);

try {
  const { stderr } = await execFileP('java', ['-version']);
  const line = (stderr || '').split('\n')[0]?.trim() || 'java present';
  record('Java', 'PASS', line);
} catch {
  record('Java', 'FAIL', 'java not on PATH (needed to run the backend jar)');
}

const dbOk = await tcpOpen(dbHost, dbPort);
record('PostgreSQL', dbOk ? 'PASS' : 'FAIL', `${dbHost}:${dbPort} ${dbOk ? 'accepting connections' : 'not reachable'}`);

const health = await httpStatus(`${backendUrl.replace(/\/$/, '')}/actuator/health`);
const backendOk = health === 200;
record(
  'Backend',
  backendOk ? 'PASS' : 'FAIL',
  `${backendUrl} -> ${health || 'no response'}${backendOk ? '' : '  (start it: node scripts/run-backend.mjs)'}`,
);

// Phase 18: the all-in-one jar serves the dashboard at "/" (legacy /healwright/ redirects);
// otherwise the standalone Node dashboard (npx healwright-report, default port 7879) is the fallback.
const base = backendUrl.replace(/\/$/, '');
const embeddedRoot = await httpStatus(`${base}/api/config`);
const embeddedLegacy = embeddedRoot === 200 ? 0 : await httpStatus(`${base}/healwright/api/config`);
if (embeddedRoot === 200 || embeddedLegacy === 200) {
  record(
    'Dashboard',
    'PASS',
    `embedded -> ${embeddedRoot === 200 ? `${base}/` : `${base}/healwright/`}`,
  );
} else {
  const standalone = await httpStatus('http://localhost:7879/api/config');
  record(
    'Dashboard',
    standalone === 200 ? 'PASS' : 'WARN',
    standalone === 200
      ? 'standalone -> http://localhost:7879'
      : 'absent  (jar without embedded reporting; run: npx healwright-report)',
  );
}

const testEnv = await httpStatus(testEnvUrl);
record(
  'test-env',
  testEnv === 200 ? 'PASS' : 'WARN',
  `${testEnvUrl} -> ${testEnv || 'no response'}${testEnv === 200 ? '' : '  (optional: only for npm run test:validation)'}`,
);

const icon = { PASS: '[ ok ]', FAIL: '[FAIL]', WARN: '[warn]' };
process.stdout.write('\nHealwright stack readiness\n');
process.stdout.write('='.repeat(78) + '\n');
for (const r of rows) {
  process.stdout.write(`${icon[r.status]}  ${r.name.padEnd(12)} ${r.detail}\n`);
}
process.stdout.write('='.repeat(78) + '\n');

const failed = rows.filter((r) => r.status === 'FAIL');
if (failed.length === 0) {
  process.stdout.write(
    [
      '\nReady. Wire Healwright into your Playwright project:\n',
      "  import { heal } from '@zouhair_elmattad/healwright';",
      '  const healedPage = heal(page, {',
      `    serverUrl: '${backendUrl}',`,
      "    className: 'MySuite',",
      "    methodName: 'myTest',",
      '  });',
      "  await healedPage.locator('#username').fill('testuser'); // self-heals on breakage\n",
    ].join('\n'),
  );
} else {
  process.stdout.write(`\nNot ready: ${failed.map((r) => r.name).join(', ')} failed. Fix the items above.\n`);
}

process.exit(failed.length === 0 ? 0 : 1);
