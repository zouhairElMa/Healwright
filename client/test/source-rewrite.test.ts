import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { requestAutoRewrite } from '../src/playwright/source-rewrite.js';

interface Received {
  method: string | undefined;
  url: string | undefined;
  confirm: string | string[] | undefined;
  body: Record<string, unknown>;
}

async function serve(
  handler: (res: ServerResponse, received: Received) => void,
): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      const entry: Received = {
        method: req.method,
        url: req.url,
        confirm: req.headers['x-healwright-apply'],
        body: raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      received.push(entry);
      handler(res, entry);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('requestAutoRewrite (phase 24)', () => {
  it('posts the session with the confirmation header and reports the transaction', async () => {
    const server = await serve((res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        transactionId: 'tx-1',
        applied: [{ id: 'a' }, { id: 'b' }],
        skipped: [{ id: 'c' }],
      }));
    });
    try {
      const outcome = await requestAutoRewrite({ serverUrl: server.url, sessionId: 'session-9' });
      expect(outcome).toEqual({ ok: true, transactionId: 'tx-1', applied: 2, skipped: 1 });
      expect(server.received).toHaveLength(1);
      expect(server.received[0]?.method).toBe('POST');
      expect(server.received[0]?.url).toBe('/api/healwright/rewrite/apply');
      expect(server.received[0]?.confirm).toBe('APPLY');
      expect(server.received[0]?.body).toEqual({ sessionId: 'session-9', auto: true });
    } finally {
      await server.close();
    }
  });

  it('turns a backend refusal into an outcome instead of throwing', async () => {
    const server = await serve((res) => {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Source rewrite is disabled');
    });
    try {
      const outcome = await requestAutoRewrite({ serverUrl: server.url, sessionId: 's' });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('403');
      expect(outcome.error).toContain('disabled');
    } finally {
      await server.close();
    }
  });

  it('returns ok:false when the backend is unreachable', async () => {
    const outcome = await requestAutoRewrite({
      serverUrl: 'http://127.0.0.1:1',
      sessionId: 's',
      timeoutMs: 2000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
  });
});
