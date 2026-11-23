---
layout: default
title: Configuration
---

# Configuration

Healwright resolves configuration in this order:

1. User options.
2. Environment variables.
3. Built-in defaults.

## Core options

| Option | Environment variable | Default |
|---|---|---|
| `healEnabled` | `HEALWRIGHT_HEAL_ENABLED` | `true` |
| `disableHealingFor` | `HEALWRIGHT_DISABLE_HEALING_FOR` | `[]` |
| `scoreCap` | `HEALWRIGHT_SCORE_CAP` | `0.6` |
| `recoveryTries` | `HEALWRIGHT_RECOVERY_TRIES` | `1` |
| `selectorType` | `HEALWRIGHT_SELECTOR_TYPE` | `css` |
| `serverUrl` | `HEALWRIGHT_SERVER_URL` | `http://localhost:7878` |
| `collectMetrics` | `HEALWRIGHT_COLLECT_METRICS` | `false` |
| `actionTimeout` | `HEALWRIGHT_ACTION_TIMEOUT` | unset |

## Healing features

| Option | Environment variable | Default |
|---|---|---|
| `backlightHealing` | `HEALWRIGHT_BACKLIGHT_HEALING` | `true` |
| `findElementsAutoHealing` | `HEALWRIGHT_FIND_ELEMENTS_AUTO_HEALING` | `false` |
| `keySelectorUrl` | `HEALWRIGHT_KEY_SELECTOR_URL` | `false` |
| `localXPathFallback` | `HEALWRIGHT_LOCAL_XPATH_FALLBACK` | `true` |
| `frameHealing` | `HEALWRIGHT_FRAME_HEALING` | `true` |
| `shadowHealing` | `HEALWRIGHT_SHADOW_HEALING` | `true` |
| `assertionHealing` | `HEALWRIGHT_ASSERTION_HEALING` | `true` |
| `identityGuard` | `HEALWRIGHT_IDENTITY_GUARD` | `true` |

## Reporting and rewriting

| Option | Environment variable | Default |
|---|---|---|
| `reporting` | `HEALWRIGHT_REPORTING` | `true` |
| `reportOnly` | `HEALWRIGHT_REPORT_ONLY` | `false` |
| `reportDir` | `HEALWRIGHT_REPORT_DIR` | `<cwd>/.healwright/reports` |
| `sourceRewrite` | `HEALWRIGHT_SOURCE_REWRITE` | `off` |

## Scoring

| Option | Environment variable | Default |
|---|---|---|
| `scoring` | `HEALWRIGHT_SCORING` | `healenium` |
| `improvements` | `HEALWRIGHT_SCORING_IMPROVEMENTS` | F1-F5 enabled in improved mode |
| `improvements.ambiguityMargin` | `HEALWRIGHT_SCORING_AMBIGUITY_MARGIN` | `0.02` |
| `improvements.evidenceSimilarity` | `HEALWRIGHT_SCORING_EVIDENCE_SIMILARITY` | `0.45` |
| `improvements.indexWeight` | `HEALWRIGHT_SCORING_INDEX_WEIGHT` | `20` |
| `improvements.genericAttributeRatio` | not exposed as a dedicated variable | `0.5` |

The default string `healenium` names the legacy scoring formula retained for compatibility. It is not the public product name. New configurations may use the equivalent `healwright` alias; both modes produce identical scores. The default `scoreCap` remains `0.6`.

## Example

```ts
const healedPage = heal(page, {
  serverUrl: 'http://localhost:7878',
  reportOnly: true,
  disableHealingFor: ['#legacy-widget'],
  scoring: 'adaptive',
});
```

```bash
export HEALWRIGHT_SERVER_URL=http://localhost:7878
export HEALWRIGHT_REPORT_ONLY=true
export HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"
```
