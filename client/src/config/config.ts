/**
 * Typed configuration. Defaults and merge order replicate Healenium:
 * application.conf (recovery-tries=1, score-cap=.6, heal-enabled=true, backlight-healing=true,
 * hlm.server.url=http://localhost:7878), RestClient.java:87 (selector-type default "cssSelector"),
 * backend application.yml (KEY_SELECTOR_URL:false, FIND_ELEMENTS_AUTO_HEALING:false).
 * Merge precedence user > env > defaults mirrors SelfHealingEngine.java:77-78 (withFallback).
 * collectMetrics defaults to false in Healwright v1 (privacy decision, phase-3 §6), although
 * the upstream backend defaults COLLECT_METRICS to true.
 */
import {
  DEFAULT_AMBIGUITY_MARGIN,
  DEFAULT_IMPROVEMENTS,
  IMPROVEMENT_FLAGS,
} from '../lcs/scoring.js';
import type { ImprovementFlag, ScoringImprovements, ScoringMode } from '../lcs/scoring.js';

export interface HealwrightConfig {
  healEnabled: boolean;
  /**
   * Selector strings (the value passed to page.locator) whose healing is disabled locally.
   * Client-side analogue of @DisableHealing (SelfHealingEngine.isHealingEnabled:143-146 =
   * heal-enabled && !annotationPresent); Playwright has no stack-scan annotation, so the
   * disable is expressed per locator here. Matched exactly against the user selector value.
   */
  disableHealingFor: string[];
  scoreCap: number;
  recoveryTries: number;
  selectorType: 'css' | 'xpath';
  backlightHealing: boolean;
  findElementsAutoHealing: boolean;
  keySelectorUrl: boolean;
  serverUrl: string;
  collectMetrics: boolean;
  imitatorMode: 'in-process';
  /**
   * Phase-6 improvement: when the user selector is XPath and imitation cannot produce a unique
   * XPath (restricted grammar rejects it, or the imitated XPath is non-unique), generate a healed
   * XPath locally from the target node instead of falling back to CSS. Clean-room alternative to
   * the paid hlm-ai getXpathSelector endpoint. Disable to restore v1 CSS-fallback behavior.
   */
  localXPathFallback: boolean;
  /**
   * Phase-6 improvement: wrap page.frameLocator() so locators resolved inside an iframe heal.
   * Healenium wraps switchTo().frame() into a self-healing driver sharing the same engine
   * (TargetLocatorProxyInvocationHandler.java:37-38), so reference capture, candidate HTML and
   * replay all run in the frame's document context. Healwright mirrors this with a frame-scoped
   * adapter + replay scope. Disable to restore v1 behavior (frame locators are not healed).
   */
  frameHealing: boolean;
  /**
   * Phase-6 improvement: heal elements inside open shadow roots. The candidate serializer inlines
   * open shadow roots as host children and the reference path crosses shadow boundaries, so LCS
   * can match shadow elements. Healenium has no shadow DOM support, so this is a pure improvement.
   * Closed shadow roots and slots are out of scope. Disable to restore v1 (plain page.content(),
   * no shadow healing — Healenium parity).
   */
  shadowHealing: boolean;
  /**
   * Phase-6 improvement: heal web-first locator assertions (expect(locator).toBeVisible(),
   * toHaveText(), ...). Playwright resolves these through the locator's internal _expect protocol,
   * which bypasses the action-method Proxy (verified v1 gap). Intercepting _expect lets a timed-out
   * not-found assertion heal and replay the SAME matcher on the healed locator. Found-but-not-matching
   * and negated (.not) failures are not healed. Disable to restore v1 (assertions never heal).
   */
  assertionHealing: boolean;
  /**
   * Phase-21 identity guard: before acting, compare the element the locator resolves to with the
   * element captured on the last successful action. When a decoy in the broken DOM still matches
   * the locator, the action would silently hit it; the guard asks the engine whether another
   * element matches the reference better and redirects only then. A confirmed identity keeps the
   * original locator, so the guard can never change a correct resolution.
   */
  identityGuard: boolean;
  /**
   * Phase-8 reporting: open a Healwright report per session (POST /healenium/report/init/{uid})
   * so healed elements land in report records, close it on page close / fixture teardown
   * (POST /healenium/report/build), and append rich local telemetry (candidates, scores,
   * timings, replay outcome) as JSONL under reportDir for the Healwright dashboard.
   * The Healwright client always initializes a report per session; without it the backend logs
   * "[REPORT] Report not found" and every report stays empty (verified 2026-11-11 on 3.5.1).
   */
  reporting: boolean;
  /** Directory for local JSONL telemetry; defaults to <cwd>/.healwright/reports. */
  reportDir?: string;
  /**
   * Phase-14 Q4: compute and log proposed healings without applying them. The original action
   * still fails (no replay, no backend healing record), and a `heal.proposed` telemetry event
   * carries the locator that WOULD have been used. Lets a real suite be audited before enabling
   * healing. Default false.
   */
  reportOnly: boolean;
  /** Default Playwright action timeout in milliseconds. */
  actionTimeout?: number;
  /**
   * Phase-24: write healed locators back into the Playwright source.
   * 'auto' (default) posts the session to the backend rewrite endpoint when the report closes,
   * so every safely healed locator of that test is rewritten once, with a journaled transaction
   * that `healwright-rewrite revert` can undo byte-for-byte. The backend still requires an explicit
   * HEALWRIGHT_APPLY_ROOTS allowlist. 'off' disables automatic writes. Report-only sessions never
   * rewrite source. Dashboard buttons and `healwright-rewrite apply` remain explicit user actions.
   */
  sourceRewrite: 'off' | 'auto';
  /**
   * Candidate scoring profile. 'adaptive' (default) decides from preserved signals and captured
   * neighbour context, and refuses when no candidate is uniquely supported. 'healenium' and its
   * 'healwright' alias retain the legacy tree-comparing formula; 'improved' enables F1..F5 below.
   */
  scoring: ScoringMode;
  /**
   * Per-fix switches for scoring: 'improved'. Unset flags default to true, so the mode is
   * usable as-is and each fix can still be disabled to measure its effect.
   */
  improvements: ScoringImprovements;
}

export const DEFAULT_CONFIG: HealwrightConfig = {
  healEnabled: true,
  disableHealingFor: [],
  scoreCap: 0.6,
  recoveryTries: 1,
  selectorType: 'css',
  backlightHealing: true,
  findElementsAutoHealing: false,
  keySelectorUrl: false,
  serverUrl: 'http://localhost:7878',
  actionTimeout: 2_000,
  collectMetrics: false,
  imitatorMode: 'in-process',
  localXPathFallback: true,
  frameHealing: true,
  shadowHealing: true,
  assertionHealing: true,
  identityGuard: true,
  reporting: true,
  reportOnly: false,
  sourceRewrite: 'auto',
  scoring: 'adaptive',
  improvements: { ...DEFAULT_IMPROVEMENTS },
};

export function resolveConfig(
  user: Partial<HealwrightConfig> = {},
  env: Record<string, string | undefined> = process.env,
): HealwrightConfig {
  const fromEnv = readEnv(env);
  const fromUser = stripUndefined(user);
  const config: HealwrightConfig = { ...DEFAULT_CONFIG, ...fromEnv, ...fromUser };
  // Nested object: merge per-flag so a user override touches only the flags it names.
  config.improvements = {
    ...DEFAULT_IMPROVEMENTS,
    ...(fromEnv.improvements ?? {}),
    ...(fromUser.improvements ?? {}),
  };
  return config;
}

function stripUndefined(user: Partial<HealwrightConfig>): Partial<HealwrightConfig> {
  return Object.fromEntries(
    Object.entries(user).filter(([, value]) => value !== undefined),
  ) as Partial<HealwrightConfig>;
}

function readEnv(env: Record<string, string | undefined>): Partial<HealwrightConfig> {
  const out: Partial<HealwrightConfig> = {};
  if (env['HEALWRIGHT_HEAL_ENABLED'] !== undefined) {
    out.healEnabled = parseBool(env['HEALWRIGHT_HEAL_ENABLED'], 'HEALWRIGHT_HEAL_ENABLED');
  }
  if (env['HEALWRIGHT_DISABLE_HEALING_FOR'] !== undefined) {
    out.disableHealingFor = parseStringList(env['HEALWRIGHT_DISABLE_HEALING_FOR']);
  }
  if (env['HEALWRIGHT_SCORE_CAP'] !== undefined) {
    out.scoreCap = parseNumber(env['HEALWRIGHT_SCORE_CAP'], 'HEALWRIGHT_SCORE_CAP');
  }
  if (env['HEALWRIGHT_RECOVERY_TRIES'] !== undefined) {
    out.recoveryTries = parseInt(env['HEALWRIGHT_RECOVERY_TRIES'], 'HEALWRIGHT_RECOVERY_TRIES');
  }
  if (env['HEALWRIGHT_SELECTOR_TYPE'] !== undefined) {
    out.selectorType = parseSelectorType(env['HEALWRIGHT_SELECTOR_TYPE']);
  }
  if (env['HEALWRIGHT_BACKLIGHT_HEALING'] !== undefined) {
    out.backlightHealing = parseBool(
      env['HEALWRIGHT_BACKLIGHT_HEALING'],
      'HEALWRIGHT_BACKLIGHT_HEALING',
    );
  }
  if (env['HEALWRIGHT_FIND_ELEMENTS_AUTO_HEALING'] !== undefined) {
    out.findElementsAutoHealing = parseBool(
      env['HEALWRIGHT_FIND_ELEMENTS_AUTO_HEALING'],
      'HEALWRIGHT_FIND_ELEMENTS_AUTO_HEALING',
    );
  }
  if (env['HEALWRIGHT_KEY_SELECTOR_URL'] !== undefined) {
    out.keySelectorUrl = parseBool(env['HEALWRIGHT_KEY_SELECTOR_URL'], 'HEALWRIGHT_KEY_SELECTOR_URL');
  }
  if (env['HEALWRIGHT_SERVER_URL'] !== undefined) {
    out.serverUrl = env['HEALWRIGHT_SERVER_URL'];
  }
  if (env['HEALWRIGHT_COLLECT_METRICS'] !== undefined) {
    out.collectMetrics = parseBool(env['HEALWRIGHT_COLLECT_METRICS'], 'HEALWRIGHT_COLLECT_METRICS');
  }
  if (env['HEALWRIGHT_LOCAL_XPATH_FALLBACK'] !== undefined) {
    out.localXPathFallback = parseBool(
      env['HEALWRIGHT_LOCAL_XPATH_FALLBACK'],
      'HEALWRIGHT_LOCAL_XPATH_FALLBACK',
    );
  }
  if (env['HEALWRIGHT_FRAME_HEALING'] !== undefined) {
    out.frameHealing = parseBool(env['HEALWRIGHT_FRAME_HEALING'], 'HEALWRIGHT_FRAME_HEALING');
  }
  if (env['HEALWRIGHT_SHADOW_HEALING'] !== undefined) {
    out.shadowHealing = parseBool(env['HEALWRIGHT_SHADOW_HEALING'], 'HEALWRIGHT_SHADOW_HEALING');
  }
  if (env['HEALWRIGHT_ASSERTION_HEALING'] !== undefined) {
    out.assertionHealing = parseBool(
      env['HEALWRIGHT_ASSERTION_HEALING'],
      'HEALWRIGHT_ASSERTION_HEALING',
    );
  }
  if (env['HEALWRIGHT_IDENTITY_GUARD'] !== undefined) {
    out.identityGuard = parseBool(env['HEALWRIGHT_IDENTITY_GUARD'], 'HEALWRIGHT_IDENTITY_GUARD');
  }
  if (env['HEALWRIGHT_REPORTING'] !== undefined) {    out.reporting = parseBool(env['HEALWRIGHT_REPORTING'], 'HEALWRIGHT_REPORTING');
  }
  if (env['HEALWRIGHT_REPORT_DIR'] !== undefined) {
    out.reportDir = env['HEALWRIGHT_REPORT_DIR'];
  }
  if (env['HEALWRIGHT_REPORT_ONLY'] !== undefined) {
    out.reportOnly = parseBool(env['HEALWRIGHT_REPORT_ONLY'], 'HEALWRIGHT_REPORT_ONLY');
  }
  if (env['HEALWRIGHT_SOURCE_REWRITE'] !== undefined) {
    out.sourceRewrite = parseSourceRewrite(env['HEALWRIGHT_SOURCE_REWRITE']);
  }
  if (env['HEALWRIGHT_ACTION_TIMEOUT'] !== undefined) {
    out.actionTimeout = parseInt(env['HEALWRIGHT_ACTION_TIMEOUT'], 'HEALWRIGHT_ACTION_TIMEOUT');
  }
  if (env['HEALWRIGHT_SCORING'] !== undefined) {
    out.scoring = parseScoringMode(env['HEALWRIGHT_SCORING']);
  }
  if (env['HEALWRIGHT_SCORING_IMPROVEMENTS'] !== undefined) {
    out.improvements = parseImprovementFlags(env['HEALWRIGHT_SCORING_IMPROVEMENTS']);
  }
  if (env['HEALWRIGHT_SCORING_AMBIGUITY_MARGIN'] !== undefined) {
    out.improvements = {
      ...(out.improvements ?? {}),
      ambiguityMargin: parseNumber(
        env['HEALWRIGHT_SCORING_AMBIGUITY_MARGIN'],
        'HEALWRIGHT_SCORING_AMBIGUITY_MARGIN',
      ),
    };
  }
  if (env['HEALWRIGHT_SCORING_EVIDENCE_SIMILARITY'] !== undefined) {
    out.improvements = {
      ...(out.improvements ?? {}),
      evidenceSimilarity: parseNumber(
        env['HEALWRIGHT_SCORING_EVIDENCE_SIMILARITY'],
        'HEALWRIGHT_SCORING_EVIDENCE_SIMILARITY',
      ),
    };
  }
  if (env['HEALWRIGHT_SCORING_INDEX_WEIGHT'] !== undefined) {
    out.improvements = {
      ...(out.improvements ?? {}),
      indexWeight: parseInt(
        env['HEALWRIGHT_SCORING_INDEX_WEIGHT'],
        'HEALWRIGHT_SCORING_INDEX_WEIGHT',
      ),
    };
  }
  if (env['HEALWRIGHT_SCORING_GENERIC_ATTRIBUTE_RATIO'] !== undefined) {
    out.improvements = {
      ...(out.improvements ?? {}),
      genericAttributeRatio: parseNumber(
        env['HEALWRIGHT_SCORING_GENERIC_ATTRIBUTE_RATIO'],
        'HEALWRIGHT_SCORING_GENERIC_ATTRIBUTE_RATIO',
      ),
    };
  }
  return out;
}

function parseBool(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Invalid boolean for ${name}: "${value}" (expected "true" or "false")`);
}

function parseNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${name}: "${value}"`);
  }
  return parsed;
}

function parseInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer for ${name}: "${value}"`);
  }
  return parsed;
}

function parseSelectorType(value: string): 'css' | 'xpath' {
  const normalized = value.trim().toLowerCase();
  // Healenium's default string is "cssSelector" (RestClient.java:87); accept it as an alias.
  if (normalized === 'css' || normalized === 'cssselector') return 'css';
  if (normalized === 'xpath') return 'xpath';
  throw new Error(`Invalid selector type: "${value}" (expected "css" or "xpath")`);
}

// Comma-separated env list. Selectors that themselves contain commas must be set via the
// programmatic disableHealingFor option instead (the env form cannot disambiguate them).
function parseStringList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseSourceRewrite(value: string): 'off' | 'auto' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'auto') {
    return normalized;
  }
  throw new Error(`Invalid source rewrite mode: "${value}" (expected "off" or "auto")`);
}

function parseScoringMode(value: string): ScoringMode {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'healwright' ||
    normalized === 'healenium' ||
    normalized === 'improved' ||
    normalized === 'adaptive'
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid scoring mode: "${value}" (expected "healwright", "healenium", "improved" or "adaptive")`,
  );
}

/**
 * Comma-separated list of ENABLED fixes (e.g. "emptyNeutrality,positionTiebreak"). Flags that
 * are absent are disabled, which is what makes per-fix before/after measurement possible.
 */
function parseImprovementFlags(value: string): ScoringImprovements {
  const enabled = new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  const improvements: ScoringImprovements = {};
  for (const name of enabled) {
    if (!(IMPROVEMENT_FLAGS as readonly string[]).includes(name)) {
      throw new Error(
        `Invalid scoring improvement: "${name}" (expected one of ${IMPROVEMENT_FLAGS.join(', ')})`,
      );
    }
    improvements[name as ImprovementFlag] = true;
  }
  for (const flag of IMPROVEMENT_FLAGS) {
    improvements[flag] ??= false;
  }
  improvements.ambiguityMargin = DEFAULT_AMBIGUITY_MARGIN;
  return improvements;
}