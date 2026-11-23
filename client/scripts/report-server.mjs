#!/usr/bin/env node
/**
 * Healwright reporting dashboard (phase-8). Serves the embedded UI and proxies the Healwright
 * backend REST surface (reports, selectors, screenshots, success/rename/status writes) so the
 * browser talks to a single origin (the backend sends no CORS headers). Also exposes the local
 * JSONL telemetry written by Healwright's LocalReporter (<report-dir>/<sessionId>.jsonl), which
 * carries what the backend drops: candidate lists, LCS timings, replay outcome.
 *
 * Reverse-engineered from healenium-backend 3.5.1: ReportController.java:38-135,
 * HealingController.java:123-154, ImageController.java:20-25. The backend's own Thymeleaf UI
 * (templates/report.html, selector.html) is served at /healenium/report and /healenium/selectors
 * but its nav links use trailing slashes, which this Spring Boot build answers with 404
 * (verified 2026-11-11); this dashboard replaces it without modifying the backend.
 *
 * Dependency-free, like doctor.mjs / run-backend.mjs.
 */
import { createServer } from 'node:http';
import { access, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token === '--port' || token === '--backend' || token === '--report-dir') {
      args[token.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      process.stderr.write(`[report] unknown argument: ${token}\n`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(
    [
      'Healwright reporting dashboard',
      '',
      'Usage: healwright-report [--port <port>] [--backend <url>] [--report-dir <path>]',
      '',
      '  --port        HTTP port for the dashboard (default 7879, env HEALWRIGHT_REPORT_PORT)',
      '  --backend     Healwright backend URL (default http://localhost:7878, env HEALWRIGHT_SERVER_URL)',
      '  --report-dir  local JSONL telemetry dir (default <cwd>/.healwright/reports, env HEALWRIGHT_REPORT_DIR)',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const PORT = Number(args.port ?? process.env.HEALWRIGHT_REPORT_PORT ?? 7879);
const BACKEND = String(args.backend ?? process.env.HEALWRIGHT_SERVER_URL ?? 'http://localhost:7878').replace(/\/+$/, '');
const REPORT_DIR = resolve(
  args['report-dir'] ?? process.env.HEALWRIGHT_REPORT_DIR ?? resolve(process.cwd(), '.healwright', 'reports'),
);

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Discovery registry shared with the client: LocalReporter records the absolute dir of every
 * project that ran tests, so the dashboard finds telemetry whatever the test cwd was.
 */
const REGISTRY_FILE = resolve(
  process.env.HEALWRIGHT_REPORT_REGISTRY ?? resolve(homedir(), '.healwright', 'dirs.json'),
);

async function telemetryDirs() {
  const dirs = [REPORT_DIR];
  try {
    const raw = JSON.parse(await readFile(REGISTRY_FILE, 'utf8'));
    for (const entry of Array.isArray(raw.dirs) ? raw.dirs : []) {
      if (typeof entry !== 'string' || !isAbsolute(entry)) {
        continue;
      }
      const dir = resolve(entry);
      if (!dirs.includes(dir)) {
        dirs.push(dir);
      }
    }
  } catch {
    // No registry (first run) or malformed: the configured dir still applies.
  }
  return dirs;
}

async function findSession(uid) {
  for (const dir of await telemetryDirs()) {
    const file = resolve(dir, `${uid}.jsonl`);
    if (!file.startsWith(dir + sep)) {
      continue;
    }
    try {
      await access(file);
      return file;
    } catch {
      // Try the next registered dir.
    }
  }
  return null;
}

const ui = await readFile(resolve(scriptDir, 'report-ui.html'), 'utf8');

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Phase-17: the first `report.meta` line names the Playwright test (testInfo.title/file).
 * Missing or torn telemetry yields no metadata; the UI then falls back to the report name.
 */
async function readReportMeta(sessionId) {
  try {
    const file = await findSession(sessionId);
    if (!file) {
      return { testName: null, testFile: null };
    }
    const raw = await readFile(file, 'utf8');
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        const event = JSON.parse(line);
        if (event.event === 'report.meta') {
          return {
            testName: typeof event.testName === 'string' ? event.testName : null,
            testFile: typeof event.testFile === 'string' ? event.testFile : null,
          };
        }
      } catch {
        // A torn line must not break the list view.
      }
    }
  } catch {
    // No telemetry file for this session.
  }
  return { testName: null, testFile: null };
}

async function listTelemetry() {
  const seen = new Map();
  for (const dir of await telemetryDirs()) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => entry.name.slice(0, -'.jsonl'.length))
        .filter((sessionId) => UID_PATTERN.test(sessionId) && !seen.has(sessionId))
        .sort((a, b) => a.localeCompare(b))
        .forEach((sessionId) => seen.set(sessionId, null));
    } catch {
      // Dir absent or unreadable: registered projects may have moved.
    }
  }
  return Promise.all([...seen.keys()].map(async (sessionId) => ({
    sessionId,
    ...(await readReportMeta(sessionId)),
  })));
}

async function readTelemetry(uid) {
  if (!UID_PATTERN.test(uid)) {
    return null;
  }
  try {
    const file = await findSession(uid);
    if (!file) {
      return null;
    }
    const raw = await readFile(file, 'utf8');
    const events = [];
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        events.push(JSON.parse(line));
      } catch {
        // A torn last line (concurrent writer) must not break the view.
      }
    }
    return { sessionId: uid, events };
  } catch {
    return null;
  }
}

/** Fixed-target proxy: only the configured backend, path whitelist by prefix. */
async function proxy(req, res, target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    sendJson(res, 400, { error: 'invalid backend url' });
    return;
  }
  if (parsed.origin !== new URL(BACKEND).origin) {
    sendJson(res, 400, { error: 'proxy target outside configured backend' });
    return;
  }
  const body = await readBody(req);
  const headers = {};
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') {
    headers['Content-Type'] = contentType;
  }
  const sessionKey = req.headers['sessionkey'];
  if (typeof sessionKey === 'string') {
    headers.sessionKey = sessionKey;
  }
  try {
    const upstream = await fetch(parsed.toString(), {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
    });
    const payload = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  } catch (e) {
    sendJson(res, 502, { error: `backend unreachable: ${e instanceof Error ? e.message : String(e)}` });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(ui);
    return;
  }
  if (req.method === 'GET' && path === '/api/config') {
    sendJson(res, 200, {
      backend: BACKEND,
      reportDir: REPORT_DIR,
      backendBase: '/backend',
      telemetryBase: '/api/telemetry',
    });
    return;
  }
  if (req.method === 'GET' && path === '/api/telemetry') {
    listTelemetry()
      .then((sessions) => sendJson(res, 200, sessions))
      .catch((e) => sendJson(res, 500, { error: String(e) }));
    return;
  }
  if (req.method === 'GET' && path === '/api/telemetry/summary') {
    proxy(req, res, BACKEND + '/api/telemetry/summary' + url.search)
      .catch((e) => sendJson(res, 500, { error: String(e) }));
    return;
  }
  if (req.method === 'GET' && path.startsWith('/api/telemetry/')) {
    const uid = path.slice('/api/telemetry/'.length);
    readTelemetry(uid)
      .then((payload) => (payload === null ? sendJson(res, 404, { error: 'no telemetry for session' }) : sendJson(res, 200, payload)))
      .catch((e) => sendJson(res, 500, { error: String(e) }));
    return;
  }
  if (path.startsWith('/backend/')) {
    proxy(req, res, BACKEND + path.slice('/backend'.length) + url.search)
      .catch((e) => sendJson(res, 500, { error: String(e) }));
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  process.stdout.write(
    `[report] Healwright reporting dashboard on http://localhost:${PORT}\n` +
      `[report] backend: ${BACKEND}\n` +
      `[report] telemetry dir: ${REPORT_DIR}\n`,
  );
});
