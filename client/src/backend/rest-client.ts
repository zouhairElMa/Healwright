/**
 * HTTP client for the Healwright backend, ported from healenium-web RestClient.java.
 * Base path "/healenium" (RestClient.java:84, HealingController.java:39); report init under
 * "/healenium/report/init/{uid}" (ReportController.java:29,62). Error handling mirrors the
 * Java asymmetry: getElements rethrows connection/404 errors (catch RuntimeException,
 * RestClient.java:158-160); every other call swallows failures with a warning.
 * The selector-imitator is in-process in Healwright (phase-3), so no imitate HTTP call here;
 * the paid hlm-ai getXpathSelector endpoint is out of scope for v1.
 */
import type {
  ConfigSelectorDto,
  ReferenceElementsDto,
  RequestDto,
} from './dto.js';
import { silentLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

/** org.openqa.selenium.json.Json.JSON_UTF_8 (imported in RestClient.java:53). */
const JSON_UTF_8 = 'application/json; charset=utf-8';
const HTTP_NOT_FOUND = 404;

export interface HttpResponseLike {
  readonly status: number;
  text(): Promise<string>;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<HttpResponseLike>;

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);

export class HealwrightConnectionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'HealwrightConnectionError';
  }
}

export class HealwrightCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HealwrightCompatibilityError';
  }
}

export interface RestClientOptions {
  serverUrl: string;
  sessionKey: string;
  hostProject?: string;
  fetch?: FetchLike;
  logger?: Logger;
}

/** Query parameters for GET /healenium (RestClient.java:204-209). */
export interface ReferenceQuery {
  locator: string;
  className: string;
  methodName: string;
  command: string;
  url: string;
}

export class RestClient {
  private readonly base: string;
  private readonly sessionKey: string;
  private readonly hostProject: string;
  private readonly fetch: FetchLike;
  private readonly logger: Logger;

  constructor(options: RestClientOptions) {
    this.base = buildBase(options.serverUrl);
    this.sessionKey = options.sessionKey;
    this.hostProject = options.hostProject ?? '';
    this.fetch = options.fetch ?? defaultFetch;
    this.logger = options.logger ?? silentLogger;
  }

  /** POST /healenium — save a successfully found element (RestClient.java:124-138). Swallows errors. */
  async saveElements(dto: RequestDto): Promise<void> {
    try {
      this.logger.debug(
        '[Save Elements] By: {}, Locator: {}, Command: {}, URL: {}',
        dto.type,
        dto.locator,
        dto.command,
        dto.url,
      );
      await this.fetch(this.base, {
        method: 'POST',
        headers: { 'Content-Type': JSON_UTF_8 },
        body: JSON.stringify(dto),
      });
    } catch (e) {
      this.logger.warn('[Save Elements] Error during call. Message: {}', errorMessage(e));
    }
  }

  /**
   * GET /healenium — last valid reference paths (RestClient.java:194-220).
   * Only HTTP 200 is parsed; any failure yields null (Optional.empty parity).
   */
  async getReferenceElements(query: ReferenceQuery): Promise<ReferenceElementsDto | null> {
    try {
      const params = new URLSearchParams({
        locator: query.locator,
        className: query.className,
        methodName: query.methodName,
        command: query.command,
        url: query.url,
      });
      this.logger.debug(
        '[Get Reference Elements] Locator: {}, Command: {}, Url: {}',
        query.locator,
        query.command,
        query.url,
      );
      const response = await this.fetch(`${this.base}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache', sessionKey: this.sessionKey },
      });
      if (response.status === 200) {
        return JSON.parse(await response.text()) as ReferenceElementsDto;
      }
      return null;
    } catch (e) {
      this.logger.warn(
        '[Get Reference Elements] Error during call. Message: {}',
        errorMessage(e),
      );
      return null;
    }
  }

  /**
   * GET /healenium/elements — saved selectors + config (RestClient.java:140-162).
   * Rethrows on connection failure and HTTP 404 (compatibility); returns null on a body
   * that cannot be parsed (Java swallows the non-runtime IOException).
   */
  async getElements(): Promise<ConfigSelectorDto | null> {
    let response: HttpResponseLike;
    try {
      response = await this.fetch(`${this.base}/elements`, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
      });
    } catch (e) {
      const message =
        '[Get Elements] Unable to connect to the hlm-backend service. ' +
        'Please check if the service is up and running, and verify that the connection URL is correct.';
      this.logger.error(message);
      throw new HealwrightConnectionError(message, e);
    }
    if (response.status === HTTP_NOT_FOUND) {
      throw new HealwrightCompatibilityError(
        '[Get Elements] Compatibility error. Hlm-backend service must be 3.3.0 and higher.',
      );
    }
    try {
      return JSON.parse(await response.text()) as ConfigSelectorDto;
    } catch (e) {
      this.logger.warn('[Get Elements] Error during call. Message: {}', errorMessage(e));
      return null;
    }
  }

  /**
   * POST /healenium/healing — persist healing results (RestClient.java:169-192).
   * Body is the list of RequestDto built by the engine; sessionKey + hostProject headers.
   * Swallows errors.
   */
  async saveHealing(dtos: RequestDto[]): Promise<void> {
    try {
      for (const dto of dtos) {
        this.logger.debug('[Save Healed Elements] {}', dto.usedResult?.locator.value);
      }
      await this.fetch(`${this.base}/healing`, {
        method: 'POST',
        headers: {
          'Content-Type': JSON_UTF_8,
          sessionKey: this.sessionKey,
          hostProject: this.hostProject,
        },
        body: JSON.stringify(dtos),
      });
    } catch (e) {
      this.logger.warn('[Heal Element] Error during call. Message: {}', errorMessage(e));
    }
  }

  /**
   * POST /healenium/report/init/{sessionId} (RestClient.java:240-250, ReportController.java:62).
   * Returns the report path body (the Java client discards it; Healwright keeps it for reports).
   * Swallows errors, yielding null.
   */
  async initReport(sessionId: string): Promise<string | null> {
    try {
      this.logger.debug('[Init Report] Session Id: {}', sessionId);
      const response = await this.fetch(
        `${this.base}/report/init/${encodeURIComponent(sessionId)}`,
        { method: 'POST', headers: { 'Content-Type': JSON_UTF_8 } },
      );
      return await response.text();
    } catch (e) {
      this.logger.warn('[Init Report] Error during call. Message: {}', errorMessage(e));
      return null;
    }
  }

  /**
   * POST /healenium/report/build with the sessionKey header (ReportController.java:69-73).
   * The backend only returns the report URL path (no state transition); calling it marks the
   * session end the same way the legacy agent does. Swallows errors, yielding null.
   */
  async buildReport(): Promise<string | null> {
    try {
      this.logger.debug('[Build Report] Session Id: {}', this.sessionKey);
      const response = await this.fetch(`${this.base}/report/build`, {
        method: 'POST',
        headers: { 'Content-Type': JSON_UTF_8, sessionKey: this.sessionKey },
      });
      return await response.text();
    } catch (e) {
      this.logger.warn('[Build Report] Error during call. Message: {}', errorMessage(e));
      return null;
    }
  }
}

function buildBase(serverUrl: string): string {
  const withScheme = serverUrl.startsWith('http') ? serverUrl : `http://${serverUrl}`;
  return `${withScheme.replace(/\/+$/, '')}/healenium`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}