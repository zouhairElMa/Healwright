/**
 * Phase-24 automatic source rewrite. When `sourceRewrite: 'auto'`, the fixture posts its session
 * id to the backend after the report closes, so every safely healed locator of that test is
 * written back to the Playwright source once. The backend owns the engine (allowlist
 * HEALWRIGHT_APPLY_ROOTS, exact before/after journal), so the automatic path, the
 * `healwright-rewrite` CLI and the dashboard produce identical, revertible edits.
 *
 * Automatic mode requires the JSONL telemetry (`reporting: true`, the default): the backend reads
 * the session file to know which locator the test actually wrote. Failures are returned, never
 * thrown — rewriting is a convenience and must not turn a passing test into a failing one.
 */

export interface AutoRewriteOutcome {
  ok: boolean;
  transactionId?: string | null;
  applied?: number;
  skipped?: number;
  error?: string;
}

export interface AutoRewriteRequest {
  serverUrl: string;
  sessionId: string;
  timeoutMs?: number;
}

export async function requestAutoRewrite(request: AutoRewriteRequest): Promise<AutoRewriteOutcome> {
  const url = `${request.serverUrl.replace(/\/+$/, '')}/api/healwright/rewrite/apply`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Healwright-Apply': 'APPLY' },
      body: JSON.stringify({ sessionId: request.sessionId, auto: true }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: `${response.status} ${text.slice(0, 500)}` };
    }
    const body = (text.length > 0 ? JSON.parse(text) : {}) as Record<string, unknown>;
    const applied = body['applied'];
    const skipped = body['skipped'];
    return {
      ok: true,
      transactionId: typeof body['transactionId'] === 'string' ? body['transactionId'] : null,
      applied: Array.isArray(applied) ? applied.length : 0,
      skipped: Array.isArray(skipped) ? skipped.length : 0,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
