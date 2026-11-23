export { Node } from './model/node.js';
export { javaHashCode, md5Hex, buildSelectorId, buildHealingId } from './backend/hash.js';
export { nodeToWire, nodeFromWire } from './backend/wire.js';
export type { WireNode } from './backend/wire.js';
export { levenshteinDistance, calculateLevenshteinScore } from './lcs/levenshtein.js';
export { union, intersect, difference } from './lcs/sets.js';
export { heuristicNodeDistance } from './lcs/node-distance.js';
export {
  resolveScoringProfile,
  hasMinimumIdentityEvidence,
  genericAttributeValues,
  findAmbiguity,
  normalizedText,
  describeNode,
  DEFAULT_IMPROVEMENTS,
  DEFAULT_AMBIGUITY_MARGIN,
  DEFAULT_INDEX_WEIGHT,
  DEFAULT_GENERIC_ATTRIBUTE_RATIO,
  MINIMUM_EVIDENCE_SIMILARITY,
  IMPROVEMENT_FLAGS,
  HEALWRIGHT_PROFILE,
  HEALENIUM_PROFILE,
  IMPROVED_BASELINE_PROFILE,
} from './lcs/scoring.js';
export type {
  ScoringMode,
  ScoringImprovements,
  ScoringProfile,
  EvidenceOptions,
  ImprovementFlag,
  ScoreEntry,
  Ambiguity,
} from './lcs/scoring.js';
export { lcsPathDistance } from './lcs/path-distance.js';
export {
  findScoresToNodes,
  getSortedNodes,
  find,
  findNearest,
} from './lcs/path-finder.js';
export type { ScoredNode, ScoresToNodes } from './lcs/path-finder.js';
export { parseTree } from './capture/parse-tree.js';
export { javaTrim, isBlank } from './utils/java-string.js';
export {
  tagComponent,
  idComponent,
  classComponent,
  positionComponent,
  attributesComponent,
  parentComponent,
  pathComponent,
  createComponent,
  constructCss,
  SELECTOR_DETAIL_LEVELS,
} from './selector/element-creators.js';
export type { SelectorComponent } from './selector/element-creators.js';
export {
  parseCssSelector,
  parseXPathSelector,
  removeQuotedText,
  ParsingError,
} from './imitator/parser.js';
export type { CssParseResult, XPathParseResult } from './imitator/parser.js';
export { cssSelectorString, xpathSelectorString } from './imitator/constructor.js';
export type { CssParts, XPathParts } from './imitator/constructor.js';
export {
  SelectorType,
  emptySelector,
  selectorFromTypeAndValue,
  selectorToString,
  selectorsEqual,
} from './imitator/selector.js';
export type { Selector } from './imitator/selector.js';
export { imitate, ImitationError } from './imitator/imitator.js';
export {
  splitClasses,
  imitatorNodeFromWire,
  imitatorNodeFromTree,
} from './imitator/node.js';
export type { ImitatorNode } from './imitator/node.js';
export { DEFAULT_CONFIG, resolveConfig } from './config/config.js';
export type { HealwrightConfig } from './config/config.js';
export { silentLogger, consoleLogger } from './utils/logger.js';
export type { Logger } from './utils/logger.js';
export type {
  Locator,
  HealingResultDto,
  SelectorDto,
  RequestDto,
  ReferenceElementsDto,
  ConfigSelectorDto,
} from './backend/dto.js';
export {
  RestClient,
  HealwrightConnectionError,
  HealwrightCompatibilityError,
} from './backend/rest-client.js';
export type {
  RestClientOptions,
  ReferenceQuery,
  FetchLike,
  FetchInit,
  HttpResponseLike,
} from './backend/rest-client.js';
export { HealingEngine } from './engine/healing-engine.js';
export type {
  BrowserAdapter,
  HealedElement,
  HealingResult,
  SessionContext,
  HealRequest,
  HealOutcome,
  HealTelemetry,
  SaveReferenceRequest,
  HealingEngineOptions,
  HealingCommand,
} from './engine/healing-engine.js';
export { heal } from './playwright/wrapper.js';
export type { HealOptions, HealwrightSessionHandle } from './playwright/wrapper.js';
export { healwrightSession } from './playwright/wrapper.js';
export { LocalReporter, nullReporter, defaultReportDir } from './report/reporter.js';
export type { TelemetrySink, LocalReporterOptions } from './report/reporter.js';
export { PlaywrightAdapter } from './playwright/adapter.js';
export type { PlaywrightAdapterOptions } from './playwright/adapter.js';
export { toPlaywrightSelector } from './playwright/selector-map.js';
export { elementFingerprint } from './playwright/fingerprint.js';
export { captureReferencePaths, itemsToNodePaths } from './playwright/capture.js';
export type { CapturedNode } from './playwright/capture.js';