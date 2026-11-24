import { describe, it, expect } from 'vitest';
import { HealingEngine } from '../src/engine/healing-engine.js';
import type { BrowserAdapter, HealRequest } from '../src/engine/healing-engine.js';
import { RestClient } from '../src/backend/rest-client.js';
import type { FetchLike, HttpResponseLike } from '../src/backend/rest-client.js';
import type {
  Locator,
  ReferenceElementsDto,
  ConfigSelectorDto,
  RequestDto,
} from '../src/backend/dto.js';
import type { WireNode } from '../src/backend/wire.js';
import { resolveConfig } from '../src/config/config.js';
import { describeNode } from '../src/lcs/scoring.js';
import { Node } from '../src/model/node.js';

function response(status: number, body: string): HttpResponseLike {
  return { status, text: async () => body };
}

const emptyConfig: ConfigSelectorDto = {
  urlForKey: false,
  pathForKey: false,
  disableHealingElementDto: [],
  enableHealingElementsDto: [],
  findElementsAutoHealing: false,
};

interface RecordedCall {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

function backendMock(reference: ReferenceElementsDto): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body, headers: init?.headers });
    if (url.endsWith('/healenium/elements')) {
      return response(200, JSON.stringify(emptyConfig));
    }
    if (method === 'GET' && url.includes('/healenium?')) {
      return response(200, JSON.stringify(reference));
    }
    return response(200, '');
  };
  return { fetch, calls };
}

function mockAdapter(opts: {
  html: string;
  matches?: Record<string, string>;
  url?: string;
  screenshot?: string;
}): { adapter: BrowserAdapter; screenshots: { locator: Locator; backlight: boolean }[] } {
  const matches = opts.matches ?? {};
  const screenshots: { locator: Locator; backlight: boolean }[] = [];
  const adapter: BrowserAdapter = {
    currentUrl: async () => opts.url ?? 'http://app.local/',
    pageContent: async () => opts.html,
    count: async (locator) => (matches[locator.value] !== undefined ? 1 : 0),
    uniqueElementId: async (locator) => matches[locator.value] ?? null,
    captureScreenshot: async (locator, backlight) => {
      screenshots.push({ locator, backlight });
      return opts.screenshot ?? 'c2hvdA==';
    },
  };
  return { adapter, screenshots };
}

function wireNode(
  tag: string,
  id: string,
  classes: string,
  index: number,
  innerText: string,
): WireNode {
  return { tag, id, classes, index, innerText, other: {} };
}

const referencePath: WireNode[] = [
  wireNode('html', '', '', 0, ''),
  wireNode('body', '', '', 0, ''),
  wireNode('div', 'main', '', 0, ''),
  wireNode('button', 'submit', '', 0, 'Submit'),
];

const renamedHtml =
  '<html><body><div id="main"><button id="submit-new">Submit</button></div></body></html>';

function makeEngine(
  reference: ReferenceElementsDto,
  adapter: BrowserAdapter,
  configOverrides = {},
  reporter?: { record(fields: Record<string, unknown>): void },
): { engine: HealingEngine; calls: RecordedCall[] } {
  const { fetch, calls } = backendMock(reference);
  const client = new RestClient({ serverUrl: 'http://h:7878', sessionKey: 'sess', fetch });
  const engine = new HealingEngine({
    config: resolveConfig(configOverrides),
    client,
    adapter,
    sessionId: 'sess',
    reporter,
  });
  return { engine, calls };
}

const healRequest: HealRequest = {
  locator: { value: '#submit', type: 'By.cssSelector' },
  command: 'findElement',
  className: 'LoginTest',
  methodName: 'shouldLogin',
  notFound: true,
};

describe('HealingEngine.heal — renamed id scenario', () => {
  const reference: ReferenceElementsDto = {
    pageContent: '',
    paths: [referencePath],
    unsuccessfulLocators: [],
  };

  it('heals to the renamed element and imitates the user CSS selector', async () => {
    const { adapter, screenshots } = mockAdapter({
      html: renamedHtml,
      matches: { 'button#submit-new': 'el-1', '#submit-new': 'el-1' },
    });
    const { engine, calls } = makeEngine(reference, adapter);
    const outcome = await engine.heal(healRequest);
    expect(outcome).not.toBeNull();
    expect(outcome?.selector).toEqual({ value: '#submit-new', type: 'By.cssSelector' });
    expect(outcome?.score).toBeGreaterThanOrEqual(0.6);
    expect(outcome?.pageContent).toBe(renamedHtml);
    expect(screenshots).toHaveLength(1);
    expect(screenshots[0]?.backlight).toBe(true);

    const healingCall = calls.find((c) => c.url.endsWith('/healenium/healing'));
    expect(healingCall?.method).toBe('POST');
    expect(healingCall?.headers?.['sessionKey']).toBe('sess');
    const dtos = JSON.parse(healingCall?.body ?? '[]') as RequestDto[];
    expect(dtos).toHaveLength(1);
    const dto = dtos[0]!;
    expect(dto.locator).toBe('#submit');
    expect(dto.type).toBe('By.cssSelector');
    expect(dto.command).toBe('findElement');
    expect(dto.className).toBe('LoginTest');
    expect(dto.methodName).toBe('shouldLogin');
    expect(dto.usedResult?.locator.value).toBe('#submit-new');
    expect(dto.results?.[0]?.locator.value).toBe('#submit-new');
    expect(dto.screenshot).toBe('c2hvdA==');
    expect(dto.elementIds).toContain('el-1');
    expect(dto.sessionId).toBe('sess');
  });

  it('returns null when healing is disabled', async () => {
    const { adapter } = mockAdapter({ html: renamedHtml });
    const { engine, calls } = makeEngine(reference, adapter, { healEnabled: false });
    expect(await engine.heal(healRequest)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('reportOnly proposes the healing without replaying or persisting it', async () => {
    const events: Record<string, unknown>[] = [];
    const { adapter, screenshots } = mockAdapter({
      html: renamedHtml,
      matches: { 'button#submit-new': 'el-1', '#submit-new': 'el-1' },
    });
    const { engine, calls } = makeEngine(reference, adapter, { reportOnly: true }, {
      record: (fields) => events.push(fields),
    });
    expect(await engine.heal(healRequest)).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/healenium/healing'))).toBe(false);
    expect(screenshots).toHaveLength(0);
    const proposed = events.find((event) => event.event === 'heal.proposed');
    expect(proposed?.healedLocator).toEqual({ value: '#submit-new', type: 'By.cssSelector' });
    expect(proposed?.margin).toBeNull();
    expect(proposed?.element).toEqual({ tag: 'button', id: 'submit-new', text: 'Submit' });
    expect(events.some((event) => event.event === 'heal.success')).toBe(false);
  });

  it('reportOnly reports the margin to the second candidate (T4d)', async () => {
    const twoButtons =
      '<html><body><div id="main"><button id="submit-new">Submit</button><button id="cancel">Cancel</button></div></body></html>';
    const events: Record<string, unknown>[] = [];
    const { adapter } = mockAdapter({
      html: twoButtons,
      matches: {
        'button#submit-new': 'el-1',
        '#submit-new': 'el-1',
        'button#cancel': 'el-2',
        '#cancel': 'el-2',
      },
    });
    const { engine } = makeEngine(reference, adapter, { reportOnly: true, scoring: 'healenium' }, {
      record: (fields) => events.push(fields),
    });
    expect(await engine.heal(healRequest)).toBeNull();
    const proposed = events.find((event) => event.event === 'heal.proposed');
    expect(proposed?.element).toEqual({ tag: 'button', id: 'submit-new', text: 'Submit' });
    expect(proposed?.margin).toBeGreaterThan(0);
    expect(proposed?.score).toBeGreaterThan(proposed?.margin as number);
  });

  it('records the Playwright expression supplied by the wrapper (failed + healed)', async () => {
    const events: Record<string, unknown>[] = [];
    const { adapter } = mockAdapter({
      html: renamedHtml,
      matches: { 'button#submit-new': 'el-1', '#submit-new': 'el-1' },
    });
    const { engine } = makeEngine(reference, adapter, { reportOnly: true }, {
      record: (fields) => events.push(fields),
    });
    const failed = "page.frameLocator('#f').locator('#submit').getByRole('button', { name: 'Submit' })";
    const root = "page.frameLocator('#f')";
    await engine.heal({
      ...healRequest,
      playwright: {
        failed,
        root,
        apis: ['frameLocator', 'locator', 'getByRole'],
        formatHealed: (locator) => `${root}.locator('${locator.value}')`,
      },
    });
    const proposed = events.find((event) => event.event === 'heal.proposed');
    expect(proposed?.playwright).toEqual({
      failed,
      root,
      apis: ['frameLocator', 'locator', 'getByRole'],
      healed: "page.frameLocator('#f').locator('#submit-new')",
    });
    // The formatter is never serialized into the JSONL event.
    expect(typeof (proposed?.playwright as Record<string, unknown>).formatHealed).toBe('undefined');
  });

  it('carries the failed Playwright expression on a miss with healed=null', async () => {
    const events: Record<string, unknown>[] = [];
    const emptyReference: ReferenceElementsDto = { ...reference, paths: [] };
    const { adapter } = mockAdapter({ html: renamedHtml });
    const { engine } = makeEngine(emptyReference, adapter, {}, {
      record: (fields) => events.push(fields),
    });
    await engine.heal({
      ...healRequest,
      playwright: {
        failed: "page.locator('#submit')",
        root: 'page',
        apis: ['locator'],
        formatHealed: (locator) => `page.locator('${locator.value}')`,
      },
    });
    const miss = events.find((event) => event.event === 'heal.miss');
    expect(miss?.playwright).toEqual({
      failed: "page.locator('#submit')",
      root: 'page',
      apis: ['locator'],
      healed: null,
    });
  });

  it('returns null when the locator is locally disabled, without any backend call', async () => {
    const { adapter } = mockAdapter({
      html: renamedHtml,
      matches: { 'button#submit-new': 'el-1', '#submit-new': 'el-1' },
    });
    const { engine, calls } = makeEngine(reference, adapter, { disableHealingFor: ['#submit'] });
    expect(await engine.heal(healRequest)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('still heals a different locator when only #submit is locally disabled', async () => {
    const { adapter } = mockAdapter({
      html: renamedHtml,
      matches: { 'button#submit-new': 'el-1', '#submit-new': 'el-1' },
    });
    const { engine } = makeEngine(reference, adapter, { disableHealingFor: ['#other'] });
    const outcome = await engine.heal(healRequest);
    expect(outcome?.selector.value).toBe('#submit-new');
  });

  it('returns null when there is no reference path', async () => {
    const { adapter } = mockAdapter({ html: renamedHtml });
    const empty: ReferenceElementsDto = { pageContent: '', paths: [], unsuccessfulLocators: [] };
    const { engine } = makeEngine(empty, adapter);
    expect(await engine.heal(healRequest)).toBeNull();
  });

  it('returns null when no candidate clears the score cap', async () => {
    const { adapter } = mockAdapter({
      html: '<html><body><section><span>totally different</span></section></body></html>',
    });
    const { engine, calls } = makeEngine(reference, adapter);
    expect(await engine.heal(healRequest)).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/healenium/healing'))).toBe(false);
  });

  it('skips candidates listed as unsuccessful locators', async () => {
    const { adapter } = mockAdapter({
      html: renamedHtml,
      matches: { 'button#submit-new': 'el-1', '#submit-new': 'el-1' },
    });
    const withUnsuccessful: ReferenceElementsDto = {
      pageContent: '',
      paths: [referencePath],
      unsuccessfulLocators: [{ value: 'button#submit-new', type: 'By.cssSelector' }],
    };
    const { engine } = makeEngine(withUnsuccessful, adapter);
    // The first detail level is skipped; later levels may still resolve, but the top
    // candidate being blocked must not crash and must still produce a consistent outcome.
    const outcome = await engine.heal(healRequest);
    if (outcome !== null) {
      expect(outcome.selector.value).not.toBe('button#submit-new');
    }
  });

  it('does not heal findElements unless auto-healing is enabled', async () => {
    const { adapter } = mockAdapter({
      html: renamedHtml,
      matches: { 'button#submit-new': 'el-1', '#submit-new': 'el-1' },
    });
    const { engine } = makeEngine(reference, adapter);
    const outcome = await engine.heal({ ...healRequest, command: 'findElements', notFound: false });
    expect(outcome).toBeNull();
  });
});

describe('HealingEngine.saveReference', () => {
  it('POSTs the wire node path to the backend', async () => {
    const { adapter } = mockAdapter({ html: renamedHtml, url: 'http://app.local/page' });
    const reference: ReferenceElementsDto = { pageContent: '', paths: [], unsuccessfulLocators: [] };
    const { engine, calls } = makeEngine(reference, adapter);
    const path = [
      new Node('html', '', new Set(), 0, new Map(), ''),
      new Node('button', 'submit', new Set(), 0, new Map(), 'Submit'),
    ];
    await engine.saveReference({
      locator: { value: '#submit', type: 'By.cssSelector' },
      command: 'findElement',
      className: 'LoginTest',
      methodName: 'shouldLogin',
      paths: [path],
    });
    const saveCall = calls.find((c) => c.method === 'POST' && c.url === 'http://h:7878/healenium');
    expect(saveCall).toBeDefined();
    const dto = JSON.parse(saveCall?.body ?? '{}') as RequestDto;
    expect(dto.locator).toBe('#submit');
    expect(dto.url).toBe('http://app.local/page');
    expect(dto.nodePath?.[0]?.[1]?.tag).toBe('button');
    expect(dto.nodePath?.[0]?.[1]?.id).toBe('submit');
    expect(dto.sessionId).toBe('sess');
  });

  it('skips saving when there are no paths', async () => {
    const { adapter } = mockAdapter({ html: renamedHtml });
    const reference: ReferenceElementsDto = { pageContent: '', paths: [], unsuccessfulLocators: [] };
    const { engine, calls } = makeEngine(reference, adapter);
    await engine.saveReference({
      locator: { value: '#x', type: 'By.cssSelector' },
      command: 'findElement',
      className: 'C',
      methodName: 'm',
      paths: [],
    });
    expect(calls).toHaveLength(0);
  });
});

describe('HealingEngine.loadSession', () => {
  it('loads backend flags without throwing', async () => {
    const { adapter } = mockAdapter({ html: renamedHtml });
    const reference: ReferenceElementsDto = { pageContent: '', paths: [], unsuccessfulLocators: [] };
    const { engine, calls } = makeEngine(reference, adapter);
    await engine.loadSession();
    expect(calls.some((c) => c.url.endsWith('/healenium/elements'))).toBe(true);
  });
});

describe('HealingEngine — phase-12 scoring profile', () => {
  const obsoletePath: WireNode[] = [
    wireNode('html', '', '', 0, ''),
    wireNode('body', '', '', 0, ''),
    wireNode('div', 'spec-deleted', '', 0, ''),
    wireNode('button', 'obsolete', '', 0, 'Archive'),
  ];
  const obsoleteHtml =
    '<html><body><div id="spec-deleted"><button id="cancel_btn">Cancel</button></div></body></html>';
  const obsoleteReference: ReferenceElementsDto = {
    pageContent: '',
    paths: [obsoletePath],
    unsuccessfulLocators: [],
  };
  const obsoleteRequest: HealRequest = {
    ...healRequest,
    locator: { value: '#obsolete', type: 'By.cssSelector' },
  };

  it('F4: healenium mode still heals the similar Cancel button (locked behaviour)', async () => {
    const { adapter } = mockAdapter({
      html: obsoleteHtml,
      matches: { 'button#cancel_btn': 'el-cancel' },
    });
    const { engine } = makeEngine(obsoleteReference, adapter, { scoring: 'healenium' });
    const outcome = await engine.heal(obsoleteRequest);
    expect(outcome?.selector.value).toBe('button#cancel_btn');
  });

  it('F4: improved mode refuses a candidate with no identity evidence', async () => {
    const { adapter } = mockAdapter({
      html: obsoleteHtml,
      matches: { 'button#cancel_btn': 'el-cancel' },
    });
    const { engine } = makeEngine(obsoleteReference, adapter, { scoring: 'improved' });
    expect(await engine.heal(obsoleteRequest)).toBeNull();
  });

  it('F4 can be disabled inside improved mode', async () => {
    const { adapter } = mockAdapter({
      html: obsoleteHtml,
      matches: { 'button#cancel_btn': 'el-cancel' },
    });
    const { engine } = makeEngine(obsoleteReference, adapter, {
      scoring: 'improved',
      improvements: { minimumEvidence: false },
    });
    const outcome = await engine.heal(obsoleteRequest);
    expect(outcome?.selector.value).toBe('button#cancel_btn');
  });

  it('F4b: a shared generic attribute is not identity evidence in improved mode', async () => {
    const genericPath: WireNode[] = [
      wireNode('html', '', '', 0, ''),
      wireNode('body', '', '', 0, ''),
      wireNode('div', 'spec-deleted', '', 0, ''),
      { ...wireNode('button', 'old', '', 0, 'Archive'), other: { type: 'button' } },
    ];
    const genericHtml =
      '<html><body><div id="spec-deleted">' +
      '<button id="b1" type="button">Cancel</button>' +
      '<button id="b2" type="button">A much longer different label</button>' +
      '</div></body></html>';
    const reference: ReferenceElementsDto = {
      pageContent: '',
      paths: [genericPath],
      unsuccessfulLocators: [],
    };
    const request: HealRequest = {
      ...healRequest,
      locator: { value: '#old', type: 'By.cssSelector' },
    };

    const withDiscount = mockAdapter({ html: genericHtml, matches: { 'button#b1': 'el-b1' } });
    const defaultEngine = makeEngine(reference, withDiscount.adapter, { scoring: 'improved' });
    expect(await defaultEngine.engine.heal(request)).toBeNull();

    const withoutDiscount = mockAdapter({ html: genericHtml, matches: { 'button#b1': 'el-b1' } });
    const permissiveEngine = makeEngine(reference, withoutDiscount.adapter, {
      scoring: 'improved',
      improvements: { genericAttributeRatio: 1 },
    });
    const outcome = await permissiveEngine.engine.heal(request);
    expect(outcome?.selector.value).toBe('button#b1');
  });

  const ambiguousPath: WireNode[] = [
    wireNode('html', '', '', 0, ''),
    wireNode('body', '', '', 0, ''),
    wireNode('div', 'main', '', 0, ''),
    wireNode('button', 'x5', '', 5, 'Delete'),
  ];
  const ambiguousHtml =
    '<html><body><div id="main"><button id="x2">Delete</button><button id="x3">Delete</button></div></body></html>';
  const ambiguousReference: ReferenceElementsDto = {
    pageContent: '',
    paths: [ambiguousPath],
    unsuccessfulLocators: [],
  };

  it('F5: healenium mode picks the first of two equally scored candidates', async () => {
    const { adapter } = mockAdapter({ html: ambiguousHtml, matches: { 'button#x2': 'el-x2' } });
    const { engine } = makeEngine(ambiguousReference, adapter, { scoring: 'healenium' });
    const outcome = await engine.heal({ ...healRequest, locator: { value: '#x5', type: 'By.cssSelector' } });
    expect(outcome?.selector.value).toBe('button#x2');
  });

  it('F5: improved mode refuses the same near-tie', async () => {
    const { adapter } = mockAdapter({ html: ambiguousHtml, matches: { 'button#x2': 'el-x2' } });
    const { engine } = makeEngine(ambiguousReference, adapter, { scoring: 'improved' });
    const outcome = await engine.heal({ ...healRequest, locator: { value: '#x5', type: 'By.cssSelector' } });
    expect(outcome).toBeNull();
  });

  it('F5: a margin of 0 disables the ambiguity guard', async () => {
    const { adapter } = mockAdapter({ html: ambiguousHtml, matches: { 'button#x2': 'el-x2' } });
    const { engine } = makeEngine(ambiguousReference, adapter, {
      scoring: 'improved',
      improvements: { ambiguityMargin: 0 },
    });
    const outcome = await engine.heal({ ...healRequest, locator: { value: '#x5', type: 'By.cssSelector' } });
    expect(outcome?.selector.value).toBe('button#x2');
  });
});

describe('HealingEngine — phase-16 adaptive mode', () => {
  const inputPath: WireNode[] = [
    wireNode('html', '', '', 0, ''),
    wireNode('body', '', '', 0, ''),
    wireNode('div', 'main', '', 0, ''),
    { ...wireNode('input', 'email_addr', '', 0, ''), other: { placeholder: 'Email' } },
  ];
  const inputReference: ReferenceElementsDto = {
    pageContent: '',
    paths: [inputPath],
    unsuccessfulLocators: [],
  };
  const inputRequest: HealRequest = {
    ...healRequest,
    locator: { value: '#email_addr', type: 'By.cssSelector' },
  };
  const inputHtml =
    '<html><body><div id="main"><input id="email_9x" placeholder="Email"></div></body></html>';

  it('heals from the preserved placeholder and tags the telemetry as adaptive', async () => {
    const events: Record<string, unknown>[] = [];
    const { adapter } = mockAdapter({
      html: inputHtml,
      matches: { 'input#email_9x': 'el-1', '#email_9x': 'el-1' },
    });
    const { engine } = makeEngine(inputReference, adapter, { scoring: 'adaptive' }, {
      record: (fields) => events.push(fields),
    });
    engine.rememberReferenceContext(inputRequest.locator, {
      index: 0,
      siblingCount: 1,
      prev: null,
      next: null,
    });
    const outcome = await engine.heal(inputRequest);
    expect(['#email_9x', 'input#email_9x']).toContain(outcome?.selector.value);
    expect(outcome?.telemetry.scoring).toBe('adaptive');
    expect(outcome?.telemetry.decision).toBe('heal');
    expect(outcome?.telemetry.signals).toContain('attr:placeholder');
    expect(events.find((event) => event.event === 'heal.success')?.scoring).toBe('adaptive');
  });

  it('refuses two strict clones with no context and reports adaptive-ambiguous', async () => {
    const clonePath: WireNode[] = [
      wireNode('html', '', '', 0, ''),
      wireNode('body', '', '', 0, ''),
      wireNode('div', 'main', '', 0, ''),
      wireNode('button', 'b_x', '', 0, 'Delete'),
    ];
    const cloneReference: ReferenceElementsDto = {
      pageContent: '',
      paths: [clonePath],
      unsuccessfulLocators: [],
    };
    const cloneHtml =
      '<html><body><div id="main"><button id="c1">Delete</button><button id="c2">Delete</button></div></body></html>';
    const events: Record<string, unknown>[] = [];
    const { adapter } = mockAdapter({ html: cloneHtml });
    const { engine } = makeEngine(cloneReference, adapter, { scoring: 'adaptive' }, {
      record: (fields) => events.push(fields),
    });
    const outcome = await engine.heal({
      ...healRequest,
      locator: { value: '#b_x', type: 'By.cssSelector' },
    });
    expect(outcome).toBeNull();
    const miss = events.find((event) => event.event === 'heal.miss');
    expect(miss?.reason).toBe('adaptive-ambiguous');
    expect(miss?.scoring).toBe('adaptive');
  });

  it('phase-21: an anchor attribute pulls in a node the LCS pool never scored', async () => {
    const anchorPath: WireNode[] = [
      wireNode('html', '', '', 0, ''),
      wireNode('body', '', '', 0, ''),
      wireNode('div', 'main', '', 0, ''),
      { ...wireNode('button', '', 'old', 0, 'Pay'), other: { 'data-bench-id': 'l5_01' } },
    ];
    const anchorReference: ReferenceElementsDto = {
      pageContent: '',
      paths: [anchorPath],
      unsuccessfulLocators: [],
    };
    // The target changed tag and classes (so it falls under the cap) but kept its testid, next to
    // a copy that kept the text and a filler span so tag-only CSS cannot resolve.
    const anchorHtml =
      '<html><body><div id="main"><div role="button" class="copy">Pay</div>' +
      '<span class="totally-new" data-bench-id="l5_01">Pay</span><span class="filler">x</span></div></body></html>';
    const { adapter } = mockAdapter({
      html: anchorHtml,
      matches: { 'span.totally-new': 'el-span', 'div#main > span': 'el-span' },
    });
    const { engine } = makeEngine(anchorReference, adapter, { scoring: 'adaptive' });
    const outcome = await engine.heal({
      ...healRequest,
      locator: { value: '.old', type: 'By.cssSelector' },
    });
    expect(outcome).not.toBeNull();
    expect(outcome?.selector.value).toBe('span.totally-new');
    expect(outcome?.telemetry.element.tag).toBe('span');
  });

  it('phase-21: a heal that lands on the already-resolved element is kept, not reported', async () => {
    const events: Record<string, unknown>[] = [];
    const { adapter } = mockAdapter({
      html: inputHtml,
      matches: { 'input#email_9x': 'el-1', '#email_9x': 'el-1' },
    });
    const { engine } = makeEngine(inputReference, adapter, { scoring: 'adaptive' }, {
      record: (fields) => events.push(fields),
    });
    engine.rememberReferenceContext(inputRequest.locator, {
      index: 0,
      siblingCount: 1,
      prev: null,
      next: null,
    });
    const outcome = await engine.heal({ ...inputRequest, currentElementId: 'el-1' });
    expect(outcome).toBeNull();
    expect(events.some((event) => event.event === 'heal.success')).toBe(false);
    expect(events.find((event) => event.event === 'identity.kept')?.reason).toBe('identity-confirmed');
  });

  it('phase-21: a different element than the resolved one is a real heal', async () => {
    const { adapter } = mockAdapter({
      html: inputHtml,
      matches: { 'input#email_9x': 'el-1', '#email_9x': 'el-1' },
    });
    const { engine } = makeEngine(inputReference, adapter, { scoring: 'adaptive' });
    engine.rememberReferenceContext(inputRequest.locator, {
      index: 0,
      siblingCount: 1,
      prev: null,
      next: null,
    });
    const outcome = await engine.heal({ ...inputRequest, currentElementId: 'el-decoy' });
    expect(['#email_9x', 'input#email_9x']).toContain(outcome?.selector.value);
  });
});
describe('HealingEngine — phase-23 candidate telemetry', () => {
  it('pairs an LCS score with every adaptive candidate next to its evidence total', async () => {
    const clonePath: WireNode[] = [
      wireNode('html', '', '', 0, ''),
      wireNode('body', '', '', 0, ''),
      wireNode('div', 'main', '', 0, ''),
      wireNode('button', 'b_x', '', 0, 'Delete'),
    ];
    const reference: ReferenceElementsDto = {
      pageContent: '',
      paths: [clonePath],
      unsuccessfulLocators: [],
    };
    const html =
      '<html><body><div id="main"><button id="c1">Delete</button><button id="c2">Delete</button></div></body></html>';
    const events: Record<string, unknown>[] = [];
    const { adapter } = mockAdapter({ html });
    const { engine } = makeEngine(reference, adapter, { scoring: 'adaptive' }, {
      record: (fields) => events.push(fields),
    });
    expect(await engine.heal({
      ...healRequest,
      locator: { value: '#b_x', type: 'By.cssSelector' },
    })).toBeNull();
    const miss = events.find((event) => event.event === 'heal.miss') as
      | { candidates?: { element: string; score: number; total: number }[] }
      | undefined;
    expect(miss?.candidates?.length).toBeGreaterThan(0);
    for (const candidate of miss?.candidates ?? []) {
      expect(typeof candidate.score).toBe('number');
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
      expect(Number.isInteger(candidate.total)).toBe(true);
    }
  });

  it('describes an element without text without an empty pair of quotes', () => {
    const described = describeNode(new Node('input', 'id5_iCPBtV', new Set(), 0, new Map(), ''));
    expect(described).toBe('input#id5_iCPBtV');
  });
});
