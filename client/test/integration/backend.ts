/**
 * In-memory stand-in for the Healenium backend, used by real-browser integration tests so the
 * Playwright layer can be exercised without a running PostgreSQL/Java service (the real backend
 * is validated in Phase 5). It implements only the REST contract the RestClient speaks:
 * save reference (POST /healenium), read reference (GET /healenium?...), config (GET .../elements),
 * persist healing (POST .../healing), report init. References are keyed exactly like the engine's
 * save/query pair: locator|className|methodName|command|url.
 */
import type { FetchLike, HttpResponseLike } from '../../src/backend/rest-client.js';
import type {
  ConfigSelectorDto,
  ReferenceElementsDto,
  RequestDto,
} from '../../src/backend/dto.js';
import type { WireNode } from '../../src/backend/wire.js';

function response(status: number, body: string): HttpResponseLike {
  return { status, text: async () => body };
}

const defaultConfig: ConfigSelectorDto = {
  urlForKey: false,
  pathForKey: false,
  disableHealingElementDto: [],
  enableHealingElementsDto: [],
  findElementsAutoHealing: false,
};

export interface InMemoryBackend {
  fetch: FetchLike;
  references: Map<string, WireNode[][]>;
  healingCalls: RequestDto[][];
  config: ConfigSelectorDto;
}

export function referenceKey(
  locator: string,
  className: string,
  methodName: string,
  command: string,
  url: string,
): string {
  return `${locator}|${className}|${methodName}|${command}|${url}`;
}

export function inMemoryBackend(config: ConfigSelectorDto = defaultConfig): InMemoryBackend {
  const references = new Map<string, WireNode[][]>();
  const healingCalls: RequestDto[][] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/healenium/elements')) {
      return response(200, JSON.stringify(config));
    }
    if (method === 'POST' && url.endsWith('/healenium')) {
      const dto = JSON.parse(init?.body ?? '{}') as RequestDto;
      const key = referenceKey(dto.locator, dto.className, dto.methodName, dto.command, dto.url);
      references.set(key, dto.nodePath ?? []);
      return response(200, '');
    }
    if (method === 'GET' && url.includes('/healenium?')) {
      const params = new URL(url).searchParams;
      const key = referenceKey(
        params.get('locator') ?? '',
        params.get('className') ?? '',
        params.get('methodName') ?? '',
        params.get('command') ?? '',
        params.get('url') ?? '',
      );
      const reference: ReferenceElementsDto = {
        pageContent: '',
        paths: references.get(key) ?? [],
        unsuccessfulLocators: [],
      };
      return response(200, JSON.stringify(reference));
    }
    if (method === 'POST' && url.endsWith('/healenium/healing')) {
      healingCalls.push(JSON.parse(init?.body ?? '[]') as RequestDto[]);
      return response(200, '');
    }
    if (url.includes('/healenium/report/init/')) {
      return response(200, 'report-path');
    }
    return response(200, '');
  };
  return { fetch, references, healingCalls, config };
}