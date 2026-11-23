/**
 * Phase-8 report lifecycle (reverse-engineered from healenium-backend 3.5.1):
 * - POST /healenium/report/init/{uid} opens the session report (ReportController.java:62-67);
 *   without it the backend drops every healing record ("[REPORT] Report not found").
 * - POST /healenium/report/build + sessionKey header closes it (ReportController.java:69-73).
 * These unit tests assert Healwright drives both, exactly once, and only when reporting is on.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { heal, healwrightSession } from '../src/playwright/wrapper.js';
import type { HealwrightSessionHandle } from '../src/playwright/wrapper.js';
import { RestClient } from '../src/backend/rest-client.js';
import type { FetchInit, FetchLike, HttpResponseLike } from '../src/backend/rest-client.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
}

function fakeBackend(calls: Call[]): FetchLike {
  return (url: string, init?: FetchInit): Promise<HttpResponseLike> => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      headers: init?.headers ?? {},
    });
    const body = url.includes('/elements')
      ? JSON.stringify({
          urlForKey: false,
          pathForKey: false,
          disableHealingElementDto: [],
          enableHealingElementsDto: [],
          findElementsAutoHealing: false,
        })
      : url.includes('/report/init/')
        ? 'healenium/report/sess-1'
        : 'ok';
    return Promise.resolve({ status: 200, text: async () => body });
  };
}

function fakePage(): { page: Page; closed: { value: boolean } } {
  const closed = { value: false };
  const page = { close: async () => { closed.value = true; } };
  return { page: page as unknown as Page, closed };
}

const initCalls = (calls: Call[]): Call[] =>
  calls.filter((c) => c.method === 'POST' && c.url.includes('/healenium/report/init/'));
const buildCalls = (calls: Call[]): Call[] =>
  calls.filter((c) => c.method === 'POST' && c.url.endsWith('/healenium/report/build'));

/** Polls the session JSONL until every expected event landed (writes are fire-and-forget). */
async function untilJsonl(dir: string, sessionId: string, events: string[]): Promise<string> {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      const content = readFileSync(resolve(dir, `${sessionId}.jsonl`), 'utf8');
      if (events.every((event) => content.includes(event))) {
        return content;
      }
    } catch {
      // file not created yet
    }
    if (Date.now() > deadline) {
      throw new Error(`telemetry events missing: ${events.join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('report lifecycle', () => {
  it('RestClient.buildReport posts /healenium/report/build with the sessionKey header', async () => {
    const calls: Call[] = [];
    const client = new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'sess-1', fetch: fakeBackend(calls) });
    const path = await client.buildReport();
    expect(path).toBe('ok');
    expect(buildCalls(calls)).toHaveLength(1);
    expect(buildCalls(calls)[0]!.headers.sessionKey).toBe('sess-1');
  });

  it('heal() opens the report once and the session handle closes it once', async () => {
    const calls: Call[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'hw-life-'));
    try {
      const client = new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'sess-1', fetch: fakeBackend(calls) });
      const { page } = fakePage();
      const healed = heal(page, { client, sessionId: 'sess-1', reporting: true, reportDir: dir });
      await new Promise((r) => setTimeout(r, 50));
      expect(initCalls(calls)).toHaveLength(1);
      expect(initCalls(calls)[0]!.url).toContain('/healenium/report/init/sess-1');

      const handle = (healed as unknown as Record<symbol, HealwrightSessionHandle | undefined>)[
        healwrightSession
      ];
      if (handle === undefined) {
        throw new Error('heal() did not expose a session handle');
      }
      expect(handle.sessionId).toBe('sess-1');
      await handle.close();
      await handle.close(); // idempotent
      expect(buildCalls(calls)).toHaveLength(1);

      await new Promise((r) => setTimeout(r, 150));
      const jsonl = await untilJsonl(dir, 'sess-1', ['report.opening', 'report.opened', 'report.closed']);
      expect(jsonl).toContain('report.opening');
      expect(jsonl).toContain('report.opened');
      expect(jsonl).toContain('report.closed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('page.close() also closes the report', async () => {
    const calls: Call[] = [];
    const client = new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'sess-2', fetch: fakeBackend(calls) });
    const { page, closed } = fakePage();
    const healed = heal(page, { client, sessionId: 'sess-2', reporting: true });
    await healed.close();
    expect(closed.value).toBe(true);
    expect(buildCalls(calls)).toHaveLength(1);
  });

  it('reporting:false opens and closes nothing', async () => {
    const calls: Call[] = [];
    const client = new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'sess-3', fetch: fakeBackend(calls) });
    const { page } = fakePage();
    const healed = heal(page, { client, sessionId: 'sess-3', reporting: false });
    const handle = (healed as unknown as Record<symbol, HealwrightSessionHandle | undefined>)[
      healwrightSession
    ];
    if (handle === undefined) {
      throw new Error('heal() did not expose a session handle');
    }
    await handle.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(initCalls(calls)).toHaveLength(0);
    expect(buildCalls(calls)).toHaveLength(0);
  });

  /** Phase-24 rewrite endpoint stand-in: records the request, replies with a fixed transaction. */
  async function rewriteServer(status: number, body: string): Promise<{
    url: string;
    received: { confirm: string | string[] | undefined; body: string }[];
    close: () => Promise<void>;
  }> {
    const received: { confirm: string | string[] | undefined; body: string }[] = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8');
      });
      req.on('end', () => {
        received.push({ confirm: req.headers['x-healwright-apply'], body: raw });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body);
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return {
      url: `http://127.0.0.1:${port}`,
      received,
      close: () => new Promise<void>((done) => server.close(() => done())),
    };
  }

  it('sourceRewrite:auto posts the session once at close and records the transaction', async () => {
    const calls: Call[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'hw-auto-'));
    const backend = await rewriteServer(200, JSON.stringify({
      transactionId: 'tx-9',
      applied: [{ id: 'a' }],
      skipped: [],
    }));
    try {
      const client = new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'sess-4', fetch: fakeBackend(calls) });
      const { page } = fakePage();
      const healed = heal(page, {
        client,
        sessionId: 'sess-4',
        reporting: true,
        reportDir: dir,
        serverUrl: backend.url,
        sourceRewrite: 'auto',
      });
      const handle = (healed as unknown as Record<symbol, HealwrightSessionHandle | undefined>)[
        healwrightSession
      ];
      if (handle === undefined) {
        throw new Error('heal() did not expose a session handle');
      }
      await handle.close();
      await handle.close(); // a second close must not rewrite twice
      expect(backend.received).toHaveLength(1);
      expect(backend.received[0]?.confirm).toBe('APPLY');
      expect(JSON.parse(backend.received[0]?.body ?? '{}')).toEqual({
        sessionId: 'sess-4',
        auto: true,
      });
      const jsonl = await untilJsonl(dir, 'sess-4', ['rewrite.auto']);
      expect(jsonl).toContain('"transactionId":"tx-9"');
      expect(jsonl).toContain('"applied":1');
    } finally {
      await backend.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sourceRewrite:off never calls the rewrite endpoint', async () => {
    const calls: Call[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'hw-off-'));
    const backend = await rewriteServer(200, '{}');
    try {
      const client = new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'sess-5', fetch: fakeBackend(calls) });
      const { page } = fakePage();
      const healed = heal(page, {
        client,
        sessionId: 'sess-5',
        reporting: true,
        reportDir: dir,
        serverUrl: backend.url,
      });
      const handle = (healed as unknown as Record<symbol, HealwrightSessionHandle | undefined>)[
        healwrightSession
      ];
      if (handle === undefined) {
        throw new Error('heal() did not expose a session handle');
      }
      await handle.close();
      expect(backend.received).toHaveLength(0);
    } finally {
      await backend.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sourceRewrite:auto records a backend refusal without failing the session', async () => {
    const calls: Call[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'hw-refuse-'));
    const backend = await rewriteServer(403, 'Source rewrite is disabled');
    try {
      const client = new RestClient({ serverUrl: 'http://localhost:7878', sessionKey: 'sess-6', fetch: fakeBackend(calls) });
      const { page } = fakePage();
      const healed = heal(page, {
        client,
        sessionId: 'sess-6',
        reporting: true,
        reportDir: dir,
        serverUrl: backend.url,
        sourceRewrite: 'auto',
      });
      const handle = (healed as unknown as Record<symbol, HealwrightSessionHandle | undefined>)[
        healwrightSession
      ];
      if (handle === undefined) {
        throw new Error('heal() did not expose a session handle');
      }
      await expect(handle.close()).resolves.toBeUndefined();
      const jsonl = await untilJsonl(dir, 'sess-6', ['rewrite.failed']);
      expect(jsonl).toContain('403');
    } finally {
      await backend.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
