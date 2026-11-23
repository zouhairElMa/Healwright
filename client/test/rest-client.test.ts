import { describe, it, expect } from 'vitest';
import {
  RestClient,
  HealwrightConnectionError,
  HealwrightCompatibilityError,
} from '../src/backend/rest-client.js';
import type {
  FetchLike,
  FetchInit,
  HttpResponseLike,
} from '../src/backend/rest-client.js';
import type {
  RequestDto,
  ReferenceElementsDto,
  ConfigSelectorDto,
} from '../src/backend/dto.js';
import type { Logger } from '../src/utils/logger.js';

interface Call {
  url: string;
  init?: FetchInit;
}

function response(status: number, body: string): HttpResponseLike {
  return { status, text: async () => body };
}

function mockFetch(
  handler: (url: string, init?: FetchInit) => HttpResponseLike | Promise<HttpResponseLike>,
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

function recordingLogger(): { logger: Logger; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    warn: (message) => {
      warnings.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
  };
  return { logger, warnings, errors };
}

const sampleDto: RequestDto = {
  locator: '#submit',
  type: 'cssSelector',
  className: 'com.example.LoginTest',
  methodName: 'shouldLogin',
  command: 'findElement',
  url: 'http://app.local/login',
  nodePath: [],
  sessionId: 'session-1',
};

describe('RestClient base URL', () => {
  it('prepends http:// and appends /healenium', async () => {
    const { fetch, calls } = mockFetch(() => response(200, '{}'));
    const client = new RestClient({ serverUrl: 'localhost:7878', sessionKey: 'k', fetch });
    await client.saveElements(sampleDto);
    expect(calls[0]?.url).toBe('http://localhost:7878/healenium');
  });

  it('keeps an existing scheme and strips trailing slashes', async () => {
    const { fetch, calls } = mockFetch(() => response(200, '{}'));
    const client = new RestClient({
      serverUrl: 'https://host:9000///',
      sessionKey: 'k',
      fetch,
    });
    await client.saveElements(sampleDto);
    expect(calls[0]?.url).toBe('https://host:9000/healenium');
  });
});

describe('RestClient.saveElements', () => {
  it('POSTs the DTO to the base path with JSON content type', async () => {
    const { fetch, calls } = mockFetch(() => response(200, ''));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch });
    await client.saveElements(sampleDto);
    const call = calls[0];
    expect(call?.url).toBe('http://h:7878/healenium');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers?.['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(call?.init?.body ?? '')).toEqual(sampleDto);
  });

  it('swallows a connection failure and logs a warning', async () => {
    const { fetch } = mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const { logger, warnings } = recordingLogger();
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch, logger });
    await expect(client.saveElements(sampleDto)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[Save Elements]');
  });
});

describe('RestClient.getReferenceElements', () => {
  const query = {
    locator: '#foo bar',
    className: 'Test',
    methodName: 'm',
    command: 'findElement',
    url: 'http://x/?a=1&b=2',
  };

  it('GETs the base path with encoded query params and session header', async () => {
    const dto: ReferenceElementsDto = {
      pageContent: '<html></html>',
      paths: [],
      unsuccessfulLocators: [],
    };
    const { fetch, calls } = mockFetch(() => response(200, JSON.stringify(dto)));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'sess', fetch });
    const result = await client.getReferenceElements(query);
    expect(result).toEqual(dto);
    const url = new URL(calls[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('http://h:7878/healenium');
    expect(url.searchParams.get('locator')).toBe('#foo bar');
    expect(url.searchParams.get('url')).toBe('http://x/?a=1&b=2');
    expect(url.searchParams.get('command')).toBe('findElement');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.headers?.['sessionKey']).toBe('sess');
    expect(calls[0]?.init?.headers?.['Cache-Control']).toBe('no-cache');
  });

  it('returns null on a non-200 status', async () => {
    const { fetch } = mockFetch(() => response(500, 'oops'));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch });
    expect(await client.getReferenceElements(query)).toBeNull();
  });

  it('returns null on a connection failure', async () => {
    const { fetch } = mockFetch(() => {
      throw new Error('down');
    });
    const { logger, warnings } = recordingLogger();
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch, logger });
    expect(await client.getReferenceElements(query)).toBeNull();
    expect(warnings[0]).toContain('[Get Reference Elements]');
  });

  it('returns null on an unparseable body', async () => {
    const { fetch } = mockFetch(() => response(200, 'not json'));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch });
    expect(await client.getReferenceElements(query)).toBeNull();
  });
});

describe('RestClient.getElements', () => {
  const config: ConfigSelectorDto = {
    urlForKey: false,
    pathForKey: false,
    disableHealingElementDto: [],
    enableHealingElementsDto: [],
    findElementsAutoHealing: false,
  };

  it('GETs /elements and parses the config', async () => {
    const { fetch, calls } = mockFetch(() => response(200, JSON.stringify(config)));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch });
    expect(await client.getElements()).toEqual(config);
    expect(calls[0]?.url).toBe('http://h:7878/healenium/elements');
    expect(calls[0]?.init?.headers?.['Cache-Control']).toBe('no-cache');
  });

  it('throws a compatibility error on HTTP 404', async () => {
    const { fetch } = mockFetch(() => response(404, ''));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch });
    await expect(client.getElements()).rejects.toBeInstanceOf(HealwrightCompatibilityError);
  });

  it('throws a connection error when fetch rejects', async () => {
    const { fetch } = mockFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const { logger, errors } = recordingLogger();
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch, logger });
    await expect(client.getElements()).rejects.toBeInstanceOf(HealwrightConnectionError);
    expect(errors).toHaveLength(1);
  });

  it('returns null on an unparseable body (non-runtime error parity)', async () => {
    const { fetch } = mockFetch(() => response(200, '<html>error</html>'));
    const { logger, warnings } = recordingLogger();
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch, logger });
    expect(await client.getElements()).toBeNull();
    expect(warnings[0]).toContain('[Get Elements]');
  });
});

describe('RestClient.saveHealing', () => {
  it('POSTs the list to /healing with session and project headers', async () => {
    const { fetch, calls } = mockFetch(() => response(200, ''));
    const client = new RestClient({
      serverUrl: 'http://h:7878',
      sessionKey: 'sess',
      hostProject: 'my-project',
      fetch,
    });
    const dtos: RequestDto[] = [
      { ...sampleDto, usedResult: { locator: { value: '#healed', type: 'cssSelector' }, score: 0.9 } },
    ];
    await client.saveHealing(dtos);
    const call = calls[0];
    expect(call?.url).toBe('http://h:7878/healenium/healing');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers?.['sessionKey']).toBe('sess');
    expect(call?.init?.headers?.['hostProject']).toBe('my-project');
    expect(call?.init?.headers?.['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(call?.init?.body ?? '')).toEqual(dtos);
  });

  it('swallows a connection failure', async () => {
    const { fetch } = mockFetch(() => {
      throw new Error('down');
    });
    const { logger, warnings } = recordingLogger();
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch, logger });
    await expect(client.saveHealing([sampleDto])).resolves.toBeUndefined();
    expect(warnings[0]).toContain('[Heal Element]');
  });
});

describe('RestClient.initReport', () => {
  it('POSTs to /report/init/{id} and returns the body', async () => {
    const { fetch, calls } = mockFetch(() => response(200, 'healenium/report/abc'));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch });
    expect(await client.initReport('abc-123')).toBe('healenium/report/abc');
    expect(calls[0]?.url).toBe('http://h:7878/healenium/report/init/abc-123');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('encodes the session id path segment', async () => {
    const { fetch, calls } = mockFetch(() => response(200, ''));
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch });
    await client.initReport('a/b c');
    expect(calls[0]?.url).toBe('http://h:7878/healenium/report/init/a%2Fb%20c');
  });

  it('returns null on a connection failure', async () => {
    const { fetch } = mockFetch(() => {
      throw new Error('down');
    });
    const { logger, warnings } = recordingLogger();
    const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'k', fetch, logger });
    expect(await client.initReport('abc')).toBeNull();
    expect(warnings[0]).toContain('[Init Report]');
  });
});