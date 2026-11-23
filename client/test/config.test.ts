import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config/config.js';

describe('DEFAULT_CONFIG (phase-3 §6, Healenium application.conf)', () => {
  it('matches the validated defaults', () => {
    expect(DEFAULT_CONFIG).toEqual({
      healEnabled: true,
      disableHealingFor: [],
      scoreCap: 0.6,
      recoveryTries: 1,
      selectorType: 'css',
      backlightHealing: true,
      findElementsAutoHealing: false,
      keySelectorUrl: false,
      serverUrl: 'http://localhost:7878',
      collectMetrics: false,
      imitatorMode: 'in-process',
      localXPathFallback: true,
      frameHealing: true,
      shadowHealing: true,
      assertionHealing: true,
      identityGuard: true,
      reporting: true,
      reportOnly: false,
      sourceRewrite: 'off',
      scoring: 'healenium',
      improvements: {
        emptyNeutrality: true,
        positionTiebreak: true,
        distinctiveSignals: true,
        minimumEvidence: true,
        ambiguityGuard: true,
        ambiguityMargin: 0.02,
        evidenceSimilarity: 0.45,
        indexWeight: 20,
        genericAttributeRatio: 0.5,
      },
    });
  });

  it('resolveConfig() with no args returns the defaults', () => {
    expect(resolveConfig({}, {})).toEqual(DEFAULT_CONFIG);
  });
});

describe('merge precedence user > env > defaults', () => {
  it('user overrides defaults', () => {
    expect(resolveConfig({ scoreCap: 0.9, healEnabled: false }, {}).scoreCap).toBe(0.9);
    expect(resolveConfig({ healEnabled: false }, {}).healEnabled).toBe(false);
  });

  it('env overrides defaults', () => {
    const config = resolveConfig({}, { HEALWRIGHT_SCORE_CAP: '0.8', HEALWRIGHT_HEAL_ENABLED: 'false' });
    expect(config.scoreCap).toBe(0.8);
    expect(config.healEnabled).toBe(false);
  });

  it('user overrides env', () => {
    const config = resolveConfig({ scoreCap: 0.7 }, { HEALWRIGHT_SCORE_CAP: '0.8' });
    expect(config.scoreCap).toBe(0.7);
  });

  it('undefined user keys do not clobber env/defaults', () => {
    const config = resolveConfig({ scoreCap: undefined }, { HEALWRIGHT_SCORE_CAP: '0.8' });
    expect(config.scoreCap).toBe(0.8);
  });
});

describe('env parsing', () => {
  it('parses booleans case-insensitively', () => {
    expect(resolveConfig({}, { HEALWRIGHT_BACKLIGHT_HEALING: 'FALSE' }).backlightHealing).toBe(false);
    expect(resolveConfig({}, { HEALWRIGHT_KEY_SELECTOR_URL: ' True ' }).keySelectorUrl).toBe(true);
  });

  it('parses numbers and integers', () => {
    expect(resolveConfig({}, { HEALWRIGHT_RECOVERY_TRIES: '3' }).recoveryTries).toBe(3);
    expect(resolveConfig({}, { HEALWRIGHT_ACTION_TIMEOUT: '5000' }).actionTimeout).toBe(5000);
  });

  it('maps selector type aliases', () => {
    expect(resolveConfig({}, { HEALWRIGHT_SELECTOR_TYPE: 'cssSelector' }).selectorType).toBe('css');
    expect(resolveConfig({}, { HEALWRIGHT_SELECTOR_TYPE: 'xpath' }).selectorType).toBe('xpath');
  });

  it('reads server url verbatim', () => {
    expect(resolveConfig({}, { HEALWRIGHT_SERVER_URL: 'http://backend:9000' }).serverUrl).toBe(
      'http://backend:9000',
    );
  });

  it('reads reporting flags from env', () => {
    const config = resolveConfig(
      {},
      { HEALWRIGHT_REPORTING: 'false', HEALWRIGHT_REPORT_DIR: '/tmp/hw-reports' },
    );
    expect(config.reporting).toBe(false);
    expect(config.reportDir).toBe('/tmp/hw-reports');
  });

  it('rejects invalid booleans, numbers, integers and selector types', () => {
    expect(() => resolveConfig({}, { HEALWRIGHT_HEAL_ENABLED: 'yes' })).toThrow(/Invalid boolean/);
    expect(() => resolveConfig({}, { HEALWRIGHT_SCORE_CAP: 'abc' })).toThrow(/Invalid number/);
    expect(() => resolveConfig({}, { HEALWRIGHT_RECOVERY_TRIES: '1.5' })).toThrow(/Invalid integer/);
    expect(() => resolveConfig({}, { HEALWRIGHT_SELECTOR_TYPE: 'id' })).toThrow(/Invalid selector type/);
  });
});

describe('disableHealingFor (local per-locator disable, analogue @DisableHealing)', () => {
  it('defaults to an empty list', () => {
    expect(resolveConfig({}, {}).disableHealingFor).toEqual([]);
  });

  it('user overrides the list', () => {
    expect(resolveConfig({ disableHealingFor: ['#a', '#b'] }, {}).disableHealingFor).toEqual([
      '#a',
      '#b',
    ]);
  });

  it('parses a comma-separated env list, trimming and dropping empties', () => {
    const config = resolveConfig({}, { HEALWRIGHT_DISABLE_HEALING_FOR: ' #a , #b ,, ' });
    expect(config.disableHealingFor).toEqual(['#a', '#b']);
  });

  it('user list overrides env list', () => {
    const config = resolveConfig(
      { disableHealingFor: ['#user'] },
      { HEALWRIGHT_DISABLE_HEALING_FOR: '#env' },
    );
    expect(config.disableHealingFor).toEqual(['#user']);
  });

  it('an empty env value yields an empty list', () => {
    expect(resolveConfig({}, { HEALWRIGHT_DISABLE_HEALING_FOR: '' }).disableHealingFor).toEqual([]);
  });
});

describe('Phase-6 improvement flags (measured, disableable)', () => {
  it('all four improvement flags default to true', () => {
    const config = resolveConfig({}, {});
    expect(config.localXPathFallback).toBe(true);
    expect(config.frameHealing).toBe(true);
    expect(config.shadowHealing).toBe(true);
    expect(config.assertionHealing).toBe(true);
  });

  it('can be disabled via user options', () => {
    const config = resolveConfig(
      { localXPathFallback: false, frameHealing: false, shadowHealing: false, assertionHealing: false },
      {},
    );
    expect(config.localXPathFallback).toBe(false);
    expect(config.frameHealing).toBe(false);
    expect(config.shadowHealing).toBe(false);
    expect(config.assertionHealing).toBe(false);
  });

  it('can be disabled via env', () => {
    const config = resolveConfig(
      {},
      {
        HEALWRIGHT_LOCAL_XPATH_FALLBACK: 'false',
        HEALWRIGHT_FRAME_HEALING: 'false',
        HEALWRIGHT_SHADOW_HEALING: 'false',
        HEALWRIGHT_ASSERTION_HEALING: 'false',
      },
    );
    expect(config.localXPathFallback).toBe(false);
    expect(config.frameHealing).toBe(false);
    expect(config.shadowHealing).toBe(false);
    expect(config.assertionHealing).toBe(false);
  });

  it('rejects invalid boolean env values', () => {
    expect(() => resolveConfig({}, { HEALWRIGHT_FRAME_HEALING: 'nope' })).toThrow(/Invalid boolean/);
    expect(() => resolveConfig({}, { HEALWRIGHT_LOCAL_XPATH_FALLBACK: 'nope' })).toThrow(
      /Invalid boolean/,
    );
    expect(() => resolveConfig({}, { HEALWRIGHT_SHADOW_HEALING: 'nope' })).toThrow(/Invalid boolean/);
    expect(() => resolveConfig({}, { HEALWRIGHT_ASSERTION_HEALING: 'nope' })).toThrow(/Invalid boolean/);
  });
});

describe('Phase-12 scoring profile (default stays healenium)', () => {
  it('defaults to healenium with every fix available but inert', () => {
    const config = resolveConfig({}, {});
    expect(config.scoring).toBe('healenium');
    expect(config.improvements).toEqual({
      emptyNeutrality: true,
      positionTiebreak: true,
      distinctiveSignals: true,
      minimumEvidence: true,
      ambiguityGuard: true,
      ambiguityMargin: 0.02,
      evidenceSimilarity: 0.45,
      indexWeight: 20,
      genericAttributeRatio: 0.5,
    });
  });

  it('accepts the Healwright scoring alias without changing the frozen default', () => {
    expect(resolveConfig({}, {}).scoring).toBe('healenium');
    expect(resolveConfig({ scoring: 'healwright' }, {}).scoring).toBe('healwright');
    expect(resolveConfig({}, { HEALWRIGHT_SCORING: 'Healwright' }).scoring).toBe('healwright');
  });

  it('selects improved via user option or env', () => {
    expect(resolveConfig({ scoring: 'improved' }, {}).scoring).toBe('improved');
    expect(resolveConfig({}, { HEALWRIGHT_SCORING: 'Improved' }).scoring).toBe('improved');
    expect(() => resolveConfig({}, { HEALWRIGHT_SCORING: 'smart' })).toThrow(/Invalid scoring mode/);
  });

  it('selects the opt-in adaptive mode without changing the default', () => {
    expect(resolveConfig({}, {}).scoring).toBe('healenium');
    expect(resolveConfig({ scoring: 'adaptive' }, {}).scoring).toBe('adaptive');
    expect(resolveConfig({}, { HEALWRIGHT_SCORING: 'Adaptive' }).scoring).toBe('adaptive');
  });

  it('enables only the listed fixes from the env list', () => {
    const config = resolveConfig(
      {},
      { HEALWRIGHT_SCORING: 'improved', HEALWRIGHT_SCORING_IMPROVEMENTS: 'emptyNeutrality' },
    );
    expect(config.improvements).toEqual({
      emptyNeutrality: true,
      positionTiebreak: false,
      distinctiveSignals: false,
      minimumEvidence: false,
      ambiguityGuard: false,
      ambiguityMargin: 0.02,
      evidenceSimilarity: 0.45,
      indexWeight: 20,
      genericAttributeRatio: 0.5,
    });
  });

  it('rejects unknown fix names', () => {
    expect(() =>
      resolveConfig({}, { HEALWRIGHT_SCORING_IMPROVEMENTS: 'emptyNeutrality,fastMode' }),
    ).toThrow(/Invalid scoring improvement/);
  });

  it('lets a user flag override the env list without resetting the other fixes', () => {
    const config = resolveConfig(
      { improvements: { ambiguityGuard: false, ambiguityMargin: 0.05 } },
      { HEALWRIGHT_SCORING_IMPROVEMENTS: 'emptyNeutrality,positionTiebreak' },
    );
    expect(config.improvements).toEqual({
      emptyNeutrality: true,
      positionTiebreak: true,
      distinctiveSignals: false,
      minimumEvidence: false,
      ambiguityGuard: false,
      ambiguityMargin: 0.05,
      evidenceSimilarity: 0.45,
      indexWeight: 20,
      genericAttributeRatio: 0.5,
    });
  });

  it('reads the ambiguity margin from env', () => {
    const config = resolveConfig({}, { HEALWRIGHT_SCORING_AMBIGUITY_MARGIN: '0.07' });
    expect(config.improvements.ambiguityMargin).toBe(0.07);
  });

  it('reads the F4 similarity and F2 index weight sweep parameters from env', () => {
    const config = resolveConfig(
      {},
      {
        HEALWRIGHT_SCORING_EVIDENCE_SIMILARITY: '0.3',
        HEALWRIGHT_SCORING_INDEX_WEIGHT: '10',
      },
    );
    expect(config.improvements.evidenceSimilarity).toBe(0.3);
    expect(config.improvements.indexWeight).toBe(10);
    expect(() =>
      resolveConfig({}, { HEALWRIGHT_SCORING_EVIDENCE_SIMILARITY: 'abc' }),
    ).toThrow(/Invalid number/);
    expect(() => resolveConfig({}, { HEALWRIGHT_SCORING_INDEX_WEIGHT: '1.5' })).toThrow(
      /Invalid integer/,
    );
  });

  it('reads the F4b generic attribute ratio from env', () => {
    const config = resolveConfig({}, { HEALWRIGHT_SCORING_GENERIC_ATTRIBUTE_RATIO: '0.75' });
    expect(config.improvements.genericAttributeRatio).toBe(0.75);
    expect(() =>
      resolveConfig({}, { HEALWRIGHT_SCORING_GENERIC_ATTRIBUTE_RATIO: 'nope' }),
    ).toThrow(/Invalid number/);
  });

  it('reads reportOnly from env and defaults to false', () => {
    expect(resolveConfig({}, {}).reportOnly).toBe(false);
    expect(resolveConfig({}, { HEALWRIGHT_REPORT_ONLY: 'true' }).reportOnly).toBe(true);
    expect(() => resolveConfig({}, { HEALWRIGHT_REPORT_ONLY: 'yes' })).toThrow(/Invalid boolean/);
  });

  it('reads sourceRewrite from env and defaults to off', () => {
    expect(resolveConfig({}, {}).sourceRewrite).toBe('off');
    expect(resolveConfig({}, { HEALWRIGHT_SOURCE_REWRITE: 'auto' }).sourceRewrite).toBe('auto');
    expect(resolveConfig({ sourceRewrite: 'auto' }, { HEALWRIGHT_SOURCE_REWRITE: 'off' })
      .sourceRewrite).toBe('auto');
    expect(() => resolveConfig({}, { HEALWRIGHT_SOURCE_REWRITE: 'semi' }))
      .toThrow(/Invalid source rewrite mode/);
  });
});