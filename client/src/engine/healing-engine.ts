/**
 * Self-healing orchestration — port of the healenium-web processor chain
 * (ProcessorConfig.findElementChainProcessor: FindElement -> GetReference -> Healing ->
 * Imitate -> FillMetrics -> SaveHealingResults). The chain logic lives here against a
 * BrowserAdapter interface so it is unit-testable without a browser; the Playwright adapter
 * supplies capture/count/screenshot and the wrapper replays the action on the healed locator
 * (phase-2 §6 structural gap: Playwright combines find+action, so a single replay is required).
 *
 * Fidelity notes:
 * - getSortedNodes uses nodeLimit 1000 (HealingService.java:65); recoveryTries limits ACCEPTED
 *   unique candidates after filtering (HealingService.java:67-71).
 * - Uniqueness = exactly one match + element-id dedup (HealingService.java:108); unsuccessful
 *   locators are skipped (HealingService.java:104,119-123).
 * - Imitation preserves the user selector type and only replaces the locator when an imitated
 *   locator resolves to the SAME unique element (SelfHealingEngine.java:121-129). Imitation
 *   failures are swallowed to an empty list, as RestClient.imitate does (RestClient.java:238-258).
 * - XPath via the paid hlm-ai service is out of scope for v1; the six CSS detail levels are
 *   always tried (HealingService.toLocator falls through to CSS even in xpath mode).
 * - collectMetrics is disabled in v1, so FillMetricsProcessor is omitted.
 */
import type { SourceLocation } from '../playwright/callsite.js';
import type { Node } from '../model/node.js';
import { parseTree } from '../capture/parse-tree.js';
import { findScoresToNodes, getSortedNodes } from '../lcs/path-finder.js';
import type { ScoredNode } from '../lcs/path-finder.js';
import { anchorNodes, decideAdaptive } from '../lcs/adaptive.js';
import type { AdaptiveCandidate, AdaptiveReason, ReferenceSnapshot } from '../lcs/adaptive.js';
import {
  describeNode,
  findAmbiguity,
  genericAttributeValues,
  hasMinimumIdentityEvidence,
  resolveScoringProfile,
} from '../lcs/scoring.js';
import type { Ambiguity, ScoringProfile } from '../lcs/scoring.js';
import { constructCss, SELECTOR_DETAIL_LEVELS } from '../selector/element-creators.js';
import { xpathCandidates } from '../selector/xpath-creators.js';
import { imitate } from '../imitator/imitator.js';
import { imitatorNodeFromTree } from '../imitator/node.js';
import { selectorFromTypeAndValue, selectorToString, SelectorType } from '../imitator/selector.js';
import { nodeToWire, nodeFromWire } from '../backend/wire.js';
import { buildSelectorId } from '../backend/hash.js';
import { locatorKey } from '../model/locator-key.js';
import type { RestClient } from '../backend/rest-client.js';
import type { Locator, RequestDto, HealingResultDto } from '../backend/dto.js';
import type { HealwrightConfig } from '../config/config.js';
import { nullReporter } from '../report/reporter.js';
import type { TelemetrySink } from '../report/reporter.js';
import { silentLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export type HealingCommand = 'findElement' | 'findElements';

/** Browser capabilities the engine needs; implemented by the Playwright adapter. */
export interface BrowserAdapter {
  currentUrl(): Promise<string>;
  /** Candidate page HTML (Healenium uses document.body.outerHTML; Healwright page.content). */
  pageContent(): Promise<string>;
  count(locator: Locator): Promise<number>;
  /** Stable identity of the unique matched element, or null when the match count is not 1. */
  uniqueElementId(locator: Locator): Promise<string | null>;
  /** Base64 screenshot, optionally backlighting the matched element first. */
  captureScreenshot(locator: Locator, backlight: boolean): Promise<string>;
  /**
   * Phase-16 adaptive: neighbour context of the unique matched element (sibling index, sibling
   * count, previous/next identity). Optional so existing adapters keep working.
   */
  captureContext?(locator: Locator): Promise<ReferenceSnapshot | null>;
}

export interface HealedElement {
  locator: Locator;
  score: number;
  elementId: string;
}

export interface HealingResult {
  paths: Node[];
  targetNodes: ScoredNode[];
  healedElements: HealedElement[];
  screenshot: string | null;
}

/** Session state loaded from GET /healenium/elements (SelfHealingEngine.loadStoredSelectors:168-182). */
export interface SessionContext {
  urlForKey: boolean;
  findElementsAutoHealing: boolean;
  enableHealingElements: Map<string, string>;
  disableHealingElement: Map<string, string>;
}

/**
 * Phase-17: exact Playwright locator written by the test, for the audit report. The engine is
 * browser-agnostic, so the wrapper supplies both the rebuilt expression and the formatter that
 * renders a healed backend locator in the same scope (page or frame).
 */
export interface PlaywrightLocatorInfo {
  /** e.g. `page.frameLocator('#f').locator('#save').getByRole('button', { name: 'Save' })` */
  failed: string;
  /** Resolution root: `page` or `page.frameLocator('#f')`. */
  root: string;
  /** Locator APIs used, outermost first. */
  apis: string[];
  /** Phase-24: test source position, when the runtime reported one. */
  callsite?: SourceLocation;
  /** Not serialized: only called to render the healed expression. */
  formatHealed(locator: Locator): string;
}

/** Serialized form carried by every heal.* telemetry event. */
export interface PlaywrightLocatorTelemetry {
  failed: string;
  root: string;
  apis: string[];
  /** Null when no candidate was accepted (heal.miss / heal.skipped). */
  healed: string | null;
  /** Phase-24: test source position, so a healed locator can be written back. */
  callsite?: SourceLocation;
}

export interface HealRequest {
  locator: Locator;
  command: HealingCommand;
  className: string;
  methodName: string;
  /** True when the original failure was "not found" (vs found-but-not-actionable). */
  notFound: boolean;
  /** Phase-17 diagnostic only; healing decisions never read it. */
  playwright?: PlaywrightLocatorInfo;
  /**
   * Phase-21 identity guard: DOM fingerprint of the element the broken locator still resolves
   * to. When the best heal is that very element, the element itself did not change identity —
   * returning null lets the wrapper replay the original locator instead of reporting a heal.
   */
  currentElementId?: string;
}

export interface HealOutcome {
  selector: Locator;
  score: number;
  pageContent: string;
  telemetry: HealTelemetry;
}

/** Phase-8: rich heal event for the local JSONL telemetry consumed by the dashboard. */
export interface HealTelemetry {
  failedLocator: Locator;
  healedLocator: Locator;
  score: number;
  /** Absolute gap to the second distinct candidate; null when only one candidate exists (T4d). */
  margin: number | null;
  /** Identity of the healed element, for the audit report (T4d). */
  element: { tag: string; id: string; text: string };
  candidates: { locator: Locator; score: number }[];
  topScores: number[];
  durationMs: number;
  url: string;
  command: HealingCommand;
  className: string;
  methodName: string;
  /** Phase-16 adaptive audit (absent in healenium/improved modes). */
  scoring?: 'adaptive';
  decision?: 'heal';
  signals?: string[];
  position?: { ref: number | null; candidate: number | null; reliable: boolean };
  /** Phase-17: Playwright expressions as written by the test (absent when not supplied). */
  playwright?: PlaywrightLocatorTelemetry;
}

export interface SaveReferenceRequest {
  locator: Locator;
  command: HealingCommand;
  className: string;
  methodName: string;
  paths: Node[][];
}

export interface HealingEngineOptions {
  config: HealwrightConfig;
  client: RestClient;
  adapter: BrowserAdapter;
  sessionId: string;
  logger?: Logger;
  reporter?: TelemetrySink;
}

interface HealingContext {
  userLocator: Locator;
  command: HealingCommand;
  className: string;
  methodName: string;
  currentUrl: string;
  pageContent: string;
  unsuccessfulLocators: Locator[];
  elementIds: Set<string>;
  healingResults: HealingResult[];
  /** F5 refusals collected per reference path (phase-12). */
  ambiguities: Ambiguity[];
  /** Candidates above the cap removed by F4 (reported as a miss when nothing remains). */
  evidenceRejections: number;
  /** Best raw scores seen across reference paths, reported on refused heals. */
  topScores: number[];
  /** Phase-16 adaptive refusals (one per reference path) with their comparable features. */
  adaptiveMisses: { reason: AdaptiveReason; candidates: AdaptiveCandidate[] }[];
  /** Adaptive features of every pooled candidate, for the success telemetry. */
  adaptiveByNode: Map<Node, AdaptiveCandidate>;
}

const CSS_TYPE = SelectorType.BY_CSS_SELECTOR;

export class HealingEngine {
  private readonly config: HealwrightConfig;
  private readonly client: RestClient;
  private readonly adapter: BrowserAdapter;
  private readonly sessionId: string;
  private readonly logger: Logger;
  private readonly reporter: TelemetrySink;
  private readonly scoringProfile: ScoringProfile;
  private session: SessionContext = emptySession();
  /**
   * Phase-16 adaptive: neighbour context captured on the last successful action, keyed by the
   * user locator. In-process only; the backend reference path is unchanged, so a fresh process
   * simply has no context and the adaptive decision falls back to preserved signals.
   */
  private readonly referenceContexts = new Map<string, ReferenceSnapshot>();

  constructor(options: HealingEngineOptions) {
    this.config = options.config;
    this.client = options.client;
    this.adapter = options.adapter;
    this.sessionId = options.sessionId;
    this.logger = options.logger ?? silentLogger;
    this.reporter = options.reporter ?? nullReporter;
    this.scoringProfile = resolveScoringProfile(this.config);
  }

  /** Load enable/disable selector maps and flags from the backend. */
  async loadSession(): Promise<void> {
    const cfg = await this.client.getElements();
    if (cfg !== null) {
      this.session = {
        urlForKey: cfg.urlForKey,
        findElementsAutoHealing: cfg.findElementsAutoHealing,
        enableHealingElements: new Map(cfg.enableHealingElementsDto.map((s) => [s.id, s.locator])),
        disableHealingElement: new Map(cfg.disableHealingElementDto.map((s) => [s.id, s.locator])),
      };
    }
  }

  async initReport(): Promise<string | null> {
    return this.client.initReport(this.sessionId);
  }

  /** POST /healenium/report/build (session end); the backend returns the report URL path. */
  async closeReport(): Promise<string | null> {
    return this.client.buildReport();
  }

  /** Phase-16 adaptive: remember the context captured after a successful action (no-op otherwise). */
  rememberReferenceContext(locator: Locator, context: ReferenceSnapshot): void {
    if (this.scoringProfile.mode !== 'adaptive') {
      return;
    }
    this.referenceContexts.set(referenceContextKey(locator), context);
  }

  /** Phase-21: the captured identity/neighbourhood, read by the wrapper's identity guard. */
  referenceSnapshot(locator: Locator): ReferenceSnapshot | null {
    return this.referenceContexts.get(referenceContextKey(locator)) ?? null;
  }

  /** Persist a successfully resolved element's reference path (FindElementProcessor:21-26). */
  async saveReference(req: SaveReferenceRequest): Promise<void> {
    if (req.paths.length === 0) {
      return;
    }
    const currentUrl = await this.adapter.currentUrl();
    const dto: RequestDto = {
      locator: locatorKey(req.locator),
      type: req.locator.type,
      className: req.className,
      methodName: req.methodName,
      command: req.command,
      url: currentUrl,
      nodePath: req.paths.map((path) => path.map(nodeToWire)),
      sessionId: this.sessionId,
    };
    await this.client.saveElements(dto);
  }

  /**
   * Run the healing chain. Returns the healed locator to replay, or null when healing is
   * disabled/ineligible, no reference exists, or no candidate clears the score cap — in which
   * case the wrapper rethrows the original error (HealingProcessor:27, ImitateProcessor:26).
   */
  async heal(req: HealRequest): Promise<HealOutcome | null> {
    const startedAt = Date.now();
    if (!this.config.healEnabled) {
      this.reporter.record({
        event: 'heal.skipped',
        reason: 'heal-disabled',
        locator: req.locator,
        playwright: this.playwrightTelemetry(req),
      });
      return null;
    }
    // Local per-locator disable: isHealingEnabled = heal-enabled && !isDisabled
    // (SelfHealingEngine.java:143-146); @DisableHealing becomes config.disableHealingFor.
    if (this.config.disableHealingFor.includes(req.locator.value)) {
      this.reporter.record({
        event: 'heal.skipped',
        reason: 'locally-disabled',
        locator: req.locator,
        playwright: this.playwrightTelemetry(req),
      });
      return null;
    }
    const currentUrl = await this.adapter.currentUrl();
    const urlKey = this.session.urlForKey ? currentUrl : '';
    if (!this.shouldHeal(req, urlKey)) {
      this.reporter.record({
        event: 'heal.skipped',
        reason: req.command === 'findElement' ? 'found-but-not-actionable' : 'findElements-auto-healing-off',
        locator: req.locator,
        url: currentUrl,
        playwright: this.playwrightTelemetry(req),
      });
      return null;
    }

    const reference = await this.client.getReferenceElements({
      locator: locatorKey(req.locator),
      className: req.className,
      methodName: req.methodName,
      command: req.command,
      url: currentUrl,
    });
    const wirePaths = reference?.paths ?? [];
    if (wirePaths.length === 0) {
      this.logger.warn(
        '[Heal] No reference data for selector {} in the database; run successful tests first.',
        req.locator.value,
      );
      this.reporter.record({
        event: 'heal.miss',
        reason: 'no-reference',
        locator: req.locator,
        url: currentUrl,
        durationMs: Date.now() - startedAt,
        playwright: this.playwrightTelemetry(req),
      });
      return null;
    }

    const pageContent = await this.adapter.pageContent();
    const destination = parseTree(pageContent);
    if (destination === null) {
      return null;
    }

    const ctx: HealingContext = {
      userLocator: req.locator,
      command: req.command,
      className: req.className,
      methodName: req.methodName,
      currentUrl,
      pageContent,
      unsuccessfulLocators: reference?.unsuccessfulLocators ?? [],
      elementIds: new Set(),
      healingResults: [],
      ambiguities: [],
      evidenceRejections: 0,
      topScores: [],
      adaptiveMisses: [],
      adaptiveByNode: new Map(),
    };

    for (const wirePath of wirePaths) {
      await this.findNewLocations(wirePath.map(nodeFromWire), destination, ctx);
    }

    if (req.currentElementId !== undefined && ctx.healingResults.length > 0) {
      // The identity guard only asks for a heal when the resolved element drifted from the one
      // captured at baseline. A result pointing back at that same element means the element is
      // intact: keeping the original locator is correct and must not be recorded as a heal.
      const moved = ctx.healingResults.filter(
        (result) => result.healedElements[0]?.elementId !== req.currentElementId,
      );
      if (moved.length === 0) {
        this.reporter.record({
          event: 'identity.kept',
          reason: 'identity-confirmed',
          locator: req.locator,
          url: currentUrl,
          durationMs: Date.now() - startedAt,
          playwright: this.playwrightTelemetry(req),
        });
        return null;
      }
      ctx.healingResults = moved;
    }

    if (ctx.healingResults.length === 0) {
      const adaptiveMiss = ctx.adaptiveMisses[0];
      if (adaptiveMiss !== undefined) {
        this.logger.warn(
          '[Heal] Adaptive mode refused selector {} ({}); no candidate was uniquely supported.',
          req.locator.value,
          adaptiveMiss.reason,
        );
        this.reporter.record({
          event: 'heal.miss',
          reason: adaptiveMiss.reason,
          scoring: 'adaptive',
          // The comparable features matter more than the raw score here: they explain the refusal.
          candidates: adaptiveMiss.candidates.map((candidate) => ({
            element: describeNode(candidate.node),
            // LCS ranking score (0..1) kept next to the evidence score: the dashboard pairs them
            // per candidate instead of showing one floating list of top scores.
            score: candidate.score,
            total: candidate.total,
            context: candidate.context,
            signals: candidate.signals,
            position: candidate.position,
          })),
          topScores: [...new Set(ctx.topScores)].sort((a, b) => b - a).slice(0, 5),
          locator: req.locator,
          url: currentUrl,
          durationMs: Date.now() - startedAt,
          playwright: this.playwrightTelemetry(req),
        });
        return null;
      }
      if (ctx.ambiguities.length > 0) {
        this.logger.warn(
          '[Heal] Ambiguous candidates (gap < {}) for selector {}; refusing to heal.',
          this.scoringProfile.ambiguityMargin,
          req.locator.value,
        );
        this.reporter.record({
          event: 'heal.miss',
          reason: 'ambiguous-candidates',
          margin: this.scoringProfile.ambiguityMargin,
          candidates: ctx.ambiguities.flatMap((ambiguity) => [
            { element: describeNode(ambiguity.first.node), score: ambiguity.first.score },
            { element: describeNode(ambiguity.second.node), score: ambiguity.second.score },
          ]),
          topScores: [...new Set(ctx.topScores)].sort((a, b) => b - a).slice(0, 5),
          locator: req.locator,
          url: currentUrl,
          durationMs: Date.now() - startedAt,
          playwright: this.playwrightTelemetry(req),
        });
        return null;
      }
      if (ctx.evidenceRejections > 0) {
        this.logger.warn(
          '[Heal] No candidate above score-cap {} carried a minimum identity signal for selector {}.',
          this.config.scoreCap,
          req.locator.value,
        );
        this.reporter.record({
          event: 'heal.miss',
          reason: 'insufficient-identity-evidence',
          rejected: ctx.evidenceRejections,
          scoreCap: this.config.scoreCap,
          topScores: [...new Set(ctx.topScores)].sort((a, b) => b - a).slice(0, 5),
          locator: req.locator,
          url: currentUrl,
          durationMs: Date.now() - startedAt,
          playwright: this.playwrightTelemetry(req),
        });
        return null;
      }
      this.logger.warn(
        '[Heal] No candidate reached score-cap {} for selector {}.',
        this.config.scoreCap,
        req.locator.value,
      );
      this.reporter.record({
        event: 'heal.miss',
        reason: 'no-candidate-above-cap',
        scoreCap: this.config.scoreCap,
        topScores: [...new Set(ctx.topScores)].sort((a, b) => b - a).slice(0, 5),
        locator: req.locator,
        url: currentUrl,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }

    if (ctx.ambiguities.length > 0) {
      this.reporter.record({
        event: 'heal.ambiguous',
        reason: 'some-reference-paths-refused',
        margin: this.scoringProfile.ambiguityMargin,
        count: ctx.ambiguities.length,
        locator: req.locator,
        url: currentUrl,
        playwright: this.playwrightTelemetry(req),
      });
    }

    for (const result of ctx.healingResults) {
      await this.imitateResult(result, ctx);
    }

    const main = ctx.healingResults[0]!.healedElements[0]!;
    const targetNodes = ctx.healingResults[0]!.targetNodes;
    const distinctNodes: ScoredNode[] = [];
    for (const scored of targetNodes) {
      if (!distinctNodes.some((other) => other.node === scored.node)) {
        distinctNodes.push(scored);
      }
    }
    const bestNode = distinctNodes[0]?.node;
    const telemetry: HealTelemetry = {
      failedLocator: req.locator,
      healedLocator: main.locator,
      score: main.score,
      margin:
        distinctNodes.length > 1 ? distinctNodes[0]!.score - distinctNodes[1]!.score : null,
      element: {
        tag: bestNode?.tag ?? '',
        id: bestNode?.id ?? '',
        text: bestNode?.innerText.trim() ?? '',
      },
      candidates: ctx.healingResults.flatMap((result) =>
        result.healedElements.map((healed) => ({ locator: healed.locator, score: healed.score })),
      ),
      topScores: targetNodes.slice(0, 5).map((scored) => scored.score),
      durationMs: Date.now() - startedAt,
      url: currentUrl,
      command: req.command,
      className: req.className,
      methodName: req.methodName,
      playwright: this.playwrightTelemetry(req, main.locator),
    };
    const adaptive = bestNode !== undefined ? ctx.adaptiveByNode.get(bestNode) : undefined;
    if (this.scoringProfile.mode === 'adaptive' && adaptive !== undefined) {
      const referencePath = ctx.healingResults[0]?.paths ?? [];
      telemetry.scoring = 'adaptive';
      telemetry.decision = 'heal';
      telemetry.signals = adaptive.signals;
      telemetry.position = {
        ref: referencePath[referencePath.length - 1]?.index ?? null,
        candidate: bestNode?.index ?? null,
        reliable: adaptive.position,
      };
    }

    if (this.config.reportOnly) {
      // Q4: propose without applying. No replay (the wrapper rethrows the original failure),
      // no screenshot and no backend healing record: the report is an audit, not a heal.
      this.reporter.record({ event: 'heal.proposed', ...telemetry });
      return null;
    }

    const dtos: RequestDto[] = [];
    for (const result of ctx.healingResults) {
      const healedMain = result.healedElements[0]!;
      result.screenshot = await this.adapter.captureScreenshot(
        healedMain.locator,
        this.config.backlightHealing,
      );
      dtos.push(this.buildHealingDto(result, ctx));
    }
    await this.client.saveHealing(dtos);

    this.reporter.record({ event: 'heal.success', ...telemetry });
    return { selector: main.locator, score: main.score, pageContent, telemetry };
  }

  /**
   * Phase-17: serialize the Playwright expression for the audit report. `healed` is omitted
   * (null) on every refusal, and the whole field is absent when the caller supplied none.
   */
  private playwrightTelemetry(
    req: HealRequest,
    healed?: Locator,
  ): PlaywrightLocatorTelemetry | undefined {
    if (req.playwright === undefined) {
      return undefined;
    }
    return {
      failed: req.playwright.failed,
      root: req.playwright.root,
      apis: [...req.playwright.apis],
      healed: healed === undefined ? null : req.playwright.formatHealed(healed),
      ...(req.playwright.callsite === undefined ? {} : { callsite: req.playwright.callsite }),
    };
  }

  /** GetReferenceElementsProcessor.validate:22-46. */
  private shouldHeal(req: HealRequest, urlKey: string): boolean {
    const fullLocator = req.locator.type + locatorKey(req.locator);
    const selectorId = buildSelectorId(locatorKey(req.locator), req.command, urlKey);
    const disableValues = [...this.session.disableHealingElement.values()];
    const enableValues = [...this.session.enableHealingElements.values()];
    if (disableValues.includes(fullLocator) && req.command === 'findElement') {
      if (this.session.disableHealingElement.has(selectorId)) {
        return false;
      }
    }
    if (enableValues.includes(fullLocator) && req.command !== 'findElement') {
      if (this.session.enableHealingElements.has(selectorId)) {
        return true;
      }
    }
    if (req.command === 'findElement') {
      return req.notFound;
    }
    return this.session.findElementsAutoHealing;
  }

  /** HealingService.findNewLocations:61-80, extended by phase-12 F4 (evidence) and F5 (ambiguity). */
  private async findNewLocations(
    path: Node[],
    destination: Node,
    ctx: HealingContext,
  ): Promise<void> {
    const referenceLeaf = path[path.length - 1];
    if (referenceLeaf === undefined) {
      return;
    }
    const scoresToNodes = findScoresToNodes(path, destination, this.scoringProfile);
    ctx.topScores.push(
      ...[...scoresToNodes.scores.keys()].sort((a, b) => b - a).slice(0, 5),
    );
    let scoreds = getSortedNodes(scoresToNodes.scores, 1000, this.config.scoreCap);
    if (this.scoringProfile.mode === 'adaptive') {
      // Phase-21: a surviving id or authored attribute (data-testid, name, alt, ...) identifies
      // the element even when a changed tag/wrapper/text pushed it below the score cap. Anchors
      // join the pool with the score the LCS gave them (0 when unscored); the decision still has
      // to prove the candidate, so this widens recall without widening what counts as evidence.
      const anchors = anchorNodes(referenceLeaf, destination);
      const pooled = new Set(scoreds.map((scored) => scored.node));
      for (const node of anchors) {
        if (!pooled.has(node)) {
          pooled.add(node);
          scoreds.push({ node, score: scoreOfNode(scoresToNodes.scores, node) });
        }
      }
      if (scoreds.length > 0) {
        // Phase-16: the Healenium formula built the pool (no index points); the decision uses
        // preserved signals plus the context captured on the last successful action. F4/F5 are
        // replaced on purpose: their identity-evidence rules are folded into the decision.
        const snapshot = this.referenceContexts.get(referenceContextKey(ctx.userLocator)) ?? null;
        const decision = decideAdaptive(referenceLeaf, scoreds, snapshot, {
          genericAttributeRatio: this.scoringProfile.genericAttributeRatio,
          root: destination,
        });
        for (const candidate of decision.candidates) {
          ctx.adaptiveByNode.set(candidate.node, candidate);
        }
        if (decision.winner === null) {
          ctx.adaptiveMisses.push({
            reason: decision.reason,
            candidates: decision.candidates.slice(0, 5),
          });
          return;
        }
        const healed = await this.toLocator(decision.winner, ctx);
        if (healed === null) {
          ctx.adaptiveMisses.push({
            reason: 'adaptive-no-evidence',
            candidates: decision.candidates.slice(0, 5),
          });
          return;
        }
        ctx.healingResults.push({
          paths: path,
          targetNodes: [decision.winner],
          healedElements: [healed],
          screenshot: null,
        });
        return;
      }
    }
    if (this.scoringProfile.minimumEvidence) {
      // F4b looks at the candidate population as a whole: an attribute value worn by most
      // candidates describes the group, not the element, so it cannot count as evidence.
      const generic = genericAttributeValues(
        scoreds.map((scored) => scored.node),
        this.scoringProfile.genericAttributeRatio,
      );
      const kept = scoreds.filter((scored) =>
        hasMinimumIdentityEvidence(
          referenceLeaf,
          scored.node,
          this.scoringProfile.evidenceSimilarity,
          { genericAttributes: generic },
        ),
      );
      ctx.evidenceRejections += scoreds.length - kept.length;
      scoreds = kept;
    }
    if (this.scoringProfile.ambiguityGuard) {
      const ambiguity = findAmbiguity(scoreds, this.scoringProfile.ambiguityMargin);
      if (ambiguity !== null) {
        ctx.ambiguities.push(ambiguity);
        return;
      }
    }
    const healedElements: HealedElement[] = [];
    for (const scored of scoreds) {
      if (healedElements.length >= this.config.recoveryTries) {
        break;
      }
      const healed = await this.toLocator(scored, ctx);
      if (healed !== null) {
        healedElements.push(healed);
      }
    }
    if (healedElements.length > 0) {
      ctx.healingResults.push({ paths: path, targetNodes: scoreds, healedElements, screenshot: null });
    }
  }

  /** HealingService.toLocator:82-100 (CSS detail levels; paid XPath omitted in v1). */
  private async toLocator(scored: ScoredNode, ctx: HealingContext): Promise<HealedElement | null> {
    for (const detailLevel of SELECTOR_DETAIL_LEVELS) {
      const css = constructCss(scored.node, detailLevel);
      const candidate: Locator = { value: css, type: CSS_TYPE };
      const healed = await this.getElementBySelectorType(candidate, scored.score, ctx);
      if (healed !== null) {
        return healed;
      }
    }
    return null;
  }

  /** HealingService.getElementBySelectorType:102-117. */
  private async getElementBySelectorType(
    candidate: Locator,
    score: number,
    ctx: HealingContext,
  ): Promise<HealedElement | null> {
    if (this.isUnsuccessLocator(candidate, ctx)) {
      return null;
    }
    const elementId = await this.adapter.uniqueElementId(candidate);
    if (elementId !== null && !ctx.elementIds.has(elementId)) {
      ctx.elementIds.add(elementId);
      return { locator: candidate, score, elementId };
    }
    return null;
  }

  private isUnsuccessLocator(candidate: Locator, ctx: HealingContext): boolean {
    return ctx.unsuccessfulLocators.some(
      (l) => l.value === candidate.value && l.type === candidate.type,
    );
  }

  /** ImitateProcessor.execute:32-41 + SelfHealingEngine.replaceHealedElementLocator:121-129. */
  private async imitateResult(result: HealingResult, ctx: HealingContext): Promise<void> {
    const top = result.targetNodes[0];
    const main = result.healedElements[0];
    if (top === undefined || main === undefined) {
      return;
    }
    try {
      const userSelector = selectorFromTypeAndValue(
        ctx.userLocator.type as SelectorType,
        ctx.userLocator.value,
      );
      const targetNode = imitatorNodeFromTree(top.node);
      const imitatedSelectors = imitate(userSelector, targetNode);
      const imitatedLocators: Locator[] = imitatedSelectors.map((selector) => ({
        value: selectorToString(selector),
        type: selector.selectorType,
      }));
      for (const loc of imitatedLocators) {
        const elementId = await this.adapter.uniqueElementId(loc);
        if (elementId !== null && elementId === main.elementId) {
          main.locator = loc;
          main.score = top.score;
        }
      }
    } catch (e) {
      this.logger.warn('[Imitate] Error during imitation: {}', e instanceof Error ? e.message : String(e));
    }

    // Phase-6 local XPath fallback: for an XPath user selector whose imitation did not yield a
    // unique XPath, generate one from the healed node (no paid hlm-ai service). Accept only a
    // candidate resolving to the SAME unique element. Disable via config.localXPathFallback.
    if (
      this.config.localXPathFallback &&
      ctx.userLocator.type === SelectorType.BY_XPATH &&
      main.locator.type !== SelectorType.BY_XPATH
    ) {
      for (const xpath of xpathCandidates(top.node)) {
        const candidate: Locator = { value: xpath, type: SelectorType.BY_XPATH };
        const elementId = await this.adapter.uniqueElementId(candidate);
        if (elementId !== null && elementId === main.elementId) {
          main.locator = candidate;
          break;
        }
      }
    }
  }

  /** HealeniumMapper.buildMultRequest:95-102 + buildDto:54-66 (className/methodName from caller). */
  private buildHealingDto(result: HealingResult, ctx: HealingContext): RequestDto {
    const choices: HealingResultDto[] = result.healedElements.map((healed) => ({
      locator: healed.locator,
      score: healed.score,
    }));
    return {
      locator: locatorKey(ctx.userLocator),
      type: ctx.userLocator.type,
      className: ctx.className,
      methodName: ctx.methodName,
      command: ctx.command,
      url: ctx.currentUrl,
      pageContent: ctx.pageContent,
      results: choices,
      usedResult: choices[0] ?? null,
      screenshot: result.screenshot,
      elementIds: [...ctx.elementIds],
      sessionId: this.sessionId,
    };
  }
}

function referenceContextKey(locator: Locator): string {
  return `${locator.type}|${locatorKey(locator)}`;
}

/** Score the LCS gave a node, or 0 when it never entered the scores map (anchor-only node). */
function scoreOfNode(scores: Map<number, Node[]>, node: Node): number {
  for (const [score, nodes] of scores) {
    if (nodes.includes(node)) {
      return score;
    }
  }
  return 0;
}

function emptySession(): SessionContext {
  return {
    urlForKey: false,
    findElementsAutoHealing: false,
    enableHealingElements: new Map(),
    disableHealingElement: new Map(),
  };
}