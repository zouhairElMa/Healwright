#!/usr/bin/env node
// Phase-24: semi-automatic source rewrite from the terminal.
//
// Lists what the Playwright telemetry says could be rewritten (failed locator -> healed locator,
// source file:line) and applies or reverts the rewrite through the backend. The backend owns the
// engine (HEALWRIGHT_APPLY_ROOTS allowlist + exact before/after journal), so a rewrite made here,
// from the dashboard and in automatic mode is the same transaction and is undone the same way.
// Dependency-free (Node builtins, global fetch).
//
// Usage:
//   healwright-rewrite list   [--session <id>] [--file <path>] [--json]
//   healwright-rewrite apply  [--session <id>] [--id <rewriteId> ...] [--all] [--manual]
//                             [--dry-run] [--json]
//   healwright-rewrite revert [--scope last|session|transaction|all] [--session <id>]
//                             [--transaction <tx>] [--id <rewriteId> ...] [--json]
//   healwright-rewrite status [--json]
// Options:
//   --server <url>   backend base url (default: HEALWRIGHT_SERVER_URL or http://localhost:7878)
//   --dry-run        print the selection that WOULD be applied, write nothing
//   --manual         also rewrite locators whose argument is not a string literal
//   --id <rewriteId> target one attempt (repeatable); overrides --session/--all selection
// Env:
//   HEALWRIGHT_SERVER_URL   backend base url
//   HEALWRIGHT_APPLY_ROOTS  backend-side allowlist: must contain the Playwright project root

const HELP = `healwright-rewrite <list|apply|revert|status> [options]

  list                       show the rewrite plan (status, file:line, failed -> healed)
  apply                      write healed locators back into the Playwright source
  revert                     restore the source from the journal (byte-identical)
  status                     show whether the backend allows writes and which roots

  --server <url>             backend base url (default http://localhost:7878)
  --session <id>             restrict to one telemetry session
  --file <path>              restrict to one test file (list)
  --id <rewriteId>           apply/revert one locator (repeatable); an "unmeasured"
                             occurrence is only written through --id
  --all                      apply every writable attempt of the selection
  --manual                   include attempts whose locator argument is a variable
  --dry-run                  apply: print the selection, write nothing
  --scope <s>                revert: last (default) | session | transaction | all
  --transaction <tx>         revert scope=transaction
  --json                     print the raw backend JSON
`;

function parseArgs(argv) {
  const out = { ids: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--server') out.server = argv[(i += 1)];
    else if (arg === '--session') out.session = argv[(i += 1)];
    else if (arg === '--file') out.file = argv[(i += 1)];
    else if (arg === '--id') out.ids.push(argv[(i += 1)]);
    else if (arg === '--scope') out.scope = argv[(i += 1)];
    else if (arg === '--transaction') out.transaction = argv[(i += 1)];
    else if (arg === '--all') out.all = true;
    else if (arg === '--manual') out.manual = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (!arg.startsWith('-')) out.command = arg;
    else throw new Error(`Unknown option: ${arg}`);
  }
  for (const key of ['server', 'session', 'file', 'scope', 'transaction']) {
    if (out[key] !== undefined && (typeof out[key] !== 'string' || out[key].length === 0)) {
      throw new Error(`Missing value for --${key}`);
    }
  }
  for (const id of out.ids) {
    if (typeof id !== 'string' || id.length === 0) throw new Error('Missing value for --id');
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (args.command === undefined) {
  process.stderr.write(HELP);
  process.exit(2);
}
const server = (args.server ?? process.env.HEALWRIGHT_SERVER_URL ?? 'http://localhost:7878')
  .replace(/\/+$/, '');

async function call(method, path, body, confirm) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (confirm) headers['X-Healwright-Apply'] = 'APPLY';
  const response = await fetch(`${server}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 800)}`);
  }
  return text.length > 0 ? JSON.parse(text) : {};
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}

function pad(value, width) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function short(value, max = 52) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function printPlan(plan, onlyWritable) {
  const items = Array.isArray(plan.items) ? plan.items : [];
  const shown = onlyWritable ? items.filter((item) => item.status === 'writable') : items;
  process.stdout.write(`rewrite ${plan.enabled ? 'enabled' : 'DISABLED'}  roots: ${
    (plan.roots ?? []).join(', ') || '(none)'}\n`);
  if (shown.length === 0) {
    process.stdout.write('  (no attempt)\n');
    return;
  }
  process.stdout.write(
    `${pad('STATUS', 11)}${pad('FILE:LINE', 42)}${pad('FAILED', 54)}${pad('HEALED VALUE', 30)}`
      + `${pad('SCORE', 7)}ID\n`,
  );
  for (const item of shown) {
    const where = `${item.file ?? '?'}:${item.line ?? '?'}`;
    process.stdout.write(
      `${pad(item.status, 11)}${pad(short(where, 41), 42)}${pad(short(item.failed, 53), 54)}`
        + `${pad(short(item.healedValue, 29), 30)}${pad(item.score ?? '-', 7)}${item.id ?? ''}\n`,
    );
    if (item.reason) process.stdout.write(`  ${item.reason}\n`);
  }
  const counts = plan.counts ?? {};
  const summary = Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(' ');
  if (summary.length > 0) process.stdout.write(`  ${summary}\n`);
}

function printDiff(entries) {
  for (const entry of entries) {
    process.stdout.write(`\n${entry.file}:${entry.line ?? entry.appliedLine ?? '?'}\n`);
    process.stdout.write(`- ${String(entry.before ?? '').trimEnd()}\n`);
    process.stdout.write(`+ ${String(entry.after ?? '').trimEnd()}\n`);
  }
}

async function main() {
  if (args.command === 'status') {
    const status = await call('GET', '/api/healwright/rewrite/status');
    if (args.json) return process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (!status.enabled) {
      process.stdout.write(
        'source rewrite is DISABLED on the backend: set HEALWRIGHT_APPLY_ROOTS to the '
          + 'Playwright project root and restart the backend.\n',
      );
      return;
    }
    process.stdout.write(`source rewrite enabled\nroots:\n`);
    for (const root of status.roots ?? []) process.stdout.write(`  ${root}\n`);
    return;
  }

  if (args.command === 'list') {
    const plan = await call('GET', `/api/healwright/rewrite/plan${query({
      session: args.session,
      file: args.file,
    })}`);
    if (args.json) return process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return printPlan(plan, false);
  }

  if (args.command === 'apply') {
    if (args.dryRun) {
      const plan = await call('GET', `/api/healwright/rewrite/plan${query({
        session: args.session,
      })}`);
      if (args.json) return process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      process.stdout.write('dry-run: nothing is written\n');
      return printPlan(plan, args.ids.length === 0);
    }
    const result = await call('POST', '/api/healwright/rewrite/apply', {
      sessionId: args.session,
      ids: args.ids.length > 0 ? args.ids : undefined,
      all: args.all === true,
      includeManual: args.manual === true,
    }, true);
    if (args.json) return process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const applied = Array.isArray(result.applied) ? result.applied : [];
    const skipped = Array.isArray(result.skipped) ? result.skipped : [];
    process.stdout.write(`transaction: ${result.transactionId ?? '(none)'}\n`);
    process.stdout.write(`applied: ${applied.length}\n`);
    printDiff(applied);
    if (skipped.length > 0) {
      process.stdout.write(`\nskipped: ${skipped.length}\n`);
      for (const item of skipped) {
        process.stdout.write(`  ${item.file ?? '?'}:${item.line ?? '?'} ${item.failed ?? ''} — ${
          item.reason ?? ''}\n`);
      }
    }
    if (applied.length > 0) {
      process.stdout.write(
        `\nundo with: healwright-rewrite revert --scope transaction --transaction ${
          result.transactionId}\n`,
      );
    }
    return;
  }

  if (args.command === 'revert') {
    const result = await call('POST', '/api/healwright/rewrite/revert', {
      // --id targets one written locator regardless of scope; the backend picks the journals.
      scope: args.ids.length > 0 ? undefined : (args.scope ?? 'last'),
      sessionId: args.session,
      transactionId: args.transaction,
      ids: args.ids.length > 0 ? args.ids : undefined,
    }, true);
    if (args.json) return process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const restored = Array.isArray(result.restored) ? result.restored : [];
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    process.stdout.write(`restored: ${restored.length}\n`);
    for (const entry of restored) {
      process.stdout.write(`  ${entry.file}:${entry.line ?? '?'} ${entry.failed ?? ''}\n`);
    }
    if (conflicts.length > 0) {
      process.stdout.write(`conflicts: ${conflicts.length} (not reverted)\n`);
      for (const entry of conflicts) {
        process.stdout.write(`  ${entry.file}:${entry.line ?? '?'} — ${entry.reason ?? ''}\n`);
      }
      process.exitCode = 1;
    }
    return;
  }

  process.stderr.write(`Unknown command: ${args.command}\n\n${HELP}`);
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`healwright-rewrite: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
