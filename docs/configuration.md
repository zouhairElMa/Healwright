---
layout: default
title: Configuration
---

# Configuration

Healwright resolves configuration in this order:

1. User options.
2. Environment variables.
3. Built-in defaults.

## Recommended default profile

Use this profile for a new local or production test installation. It uses the measured `adaptive` scoring profile and the benchmarked 2-second action timeout while retaining `scoreCap: 0.6` and the existing improvement parameters.

| Layer | Setting | Default |
|---|---|---|
| Client | `healEnabled` | `true` |
| Client | `scoreCap` | `0.6` |
| Client | `recoveryTries` | `1` |
| Client | `scoring` | `adaptive` |
| Client | `actionTimeout` | `2_000` ms |
| Client | `serverUrl` | `http://localhost:7878` |
| Client | `reporting` | `true` |
| Client | `reportOnly` | `false` |
| Client | `reportDir` | `<cwd>/.healwright/reports` |
| Client | `sourceRewrite` | `auto` |
| Backend launcher | `SPRING_SERVER_PORT` | `7878` |
| Backend launcher | `SPRING_POSTGRES_DB_HOST` | `localhost` |
| Backend launcher | `SPRING_POSTGRES_DB_PORT` | `5432` |
| Backend launcher | `SPRING_POSTGRES_DB` | `healwright` |
| Backend launcher | `SPRING_POSTGRES_SCHEMA` | `healwright` |
| Backend launcher | `SPRING_POSTGRES_USER` | `healwright_user` |
| Backend launcher | `SPRING_POSTGRES_PASSWORD` | required; no fallback |
| Backend launcher | `HEALWRIGHT_REPORT_DIR` | `<cwd>/.healwright/reports` |
| Backend launcher | `HEALWRIGHT_APPLY_ROOTS` | `<cwd>` |
| Backend launcher | `COLLECT_METRICS` | `false` |
| Playwright | test `timeout` | `120_000` ms for the verified healing scenario |

`className` and `methodName` are report metadata for a particular test, not global production defaults. The Playwright fixture automatically uses the real test title and file unless you override them.

There is no single timeout that is optimal for every application. The production profile gives the original action 2 seconds to fail, then leaves enough total test time for backend lookup and replay. Increase `healOptions.actionTimeout` and the total test timeout for slower applications; keep the total test timeout longer than the action timeout.

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
| `actionTimeout` | `HEALWRIGHT_ACTION_TIMEOUT` | `2_000` ms |
| `imitatorMode` | not exposed | `in-process` |

Healwright applies `actionTimeout` with Playwright's `page.setDefaultTimeout()`. The built-in value is `2_000` ms. In the Playwright fixture, set `healOptions.actionTimeout` to override it; if you also use Playwright's native `test.use({ actionTimeout })`, keep both values aligned.

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
| `sourceRewrite` | `HEALWRIGHT_SOURCE_REWRITE` | `auto` |

Automatic source rewriting still requires the backend allowlist `HEALWRIGHT_APPLY_ROOTS`. The standard `healwright-backend` launcher sets it to the current project directory. `reportOnly: true` always suppresses rewriting, and `sourceRewrite: 'off'` disables automatic writes explicitly.

Reporting must remain enabled for automatic rewriting because the backend needs the measured JSONL session. If reporting is disabled while `sourceRewrite` remains `auto`, Healwright skips rewriting and records a warning.

## Scoring

| Option | Environment variable | Default |
|---|---|---|
| `scoring` | `HEALWRIGHT_SCORING` | `adaptive` |
| `improvements` | `HEALWRIGHT_SCORING_IMPROVEMENTS` | F1-F5 enabled in improved mode |
| `improvements.ambiguityMargin` | `HEALWRIGHT_SCORING_AMBIGUITY_MARGIN` | `0.02` |
| `improvements.evidenceSimilarity` | `HEALWRIGHT_SCORING_EVIDENCE_SIMILARITY` | `0.45` |
| `improvements.indexWeight` | `HEALWRIGHT_SCORING_INDEX_WEIGHT` | `20` |
| `improvements.genericAttributeRatio` | `HEALWRIGHT_SCORING_GENERIC_ATTRIBUTE_RATIO` | `0.5` |

`adaptive` is the production default. It uses preserved signals and captured neighbour context, and refuses when no candidate is uniquely supported. The legacy `healenium` profile and its equivalent `healwright` alias remain selectable for compatibility; `improved` enables the F1-F5/F4b profile. The default `scoreCap` remains `0.6`, and the improvement parameters are unchanged.

In adaptive mode, `improvements.genericAttributeRatio` still controls generic-attribute handling. The other improvement switches apply to the improved profile. Use a frozen benchmark before changing scoring modes or thresholds in an existing project.

## Complete backend launcher configuration

After creating the database, the standard launcher needs only the password for a fresh installation:

```bash
cd /path/to/your/playwright-project
export SPRING_POSTGRES_PASSWORD='<your-password>'
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
```

The launcher applies the backend defaults from the recommended profile and prints the selected port, database identifiers, and rewrite roots at startup. Every value can be overridden through its environment variable. For a legacy database, set `SPRING_POSTGRES_DB`, `SPRING_POSTGRES_SCHEMA`, and `SPRING_POSTGRES_USER` explicitly.

For a direct `java -jar` deployment, export the complete profile shown in the [backend guide](backend.md#configure-and-run).

## Playwright timing profile

The verified browser scenario uses a 120-second total test timeout and the built-in 2-second action timeout:

```ts
test.setTimeout(120_000);

test.use({
  healOptions: {
    actionTimeout: 2_000,
  },
});
```

The explicit `healOptions.actionTimeout` documents the production value; omitting it has the same effect. Healing begins only after the original locator action fails. The total test timeout must cover page load, the failed action, backend lookup, replay, assertions, and teardown. A 30-second total timeout can stop the test before healing completes.

## Examples

Read-only audit without replay or source writes:

```ts
const healedPage = heal(page, {
  serverUrl: 'http://localhost:7878',
  reportOnly: true,
  disableHealingFor: ['#legacy-widget'],
});
```

Environment-based configuration:

```bash
export HEALWRIGHT_SERVER_URL=http://localhost:7878
export HEALWRIGHT_REPORT_ONLY=true
export HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"
export HEALWRIGHT_SOURCE_REWRITE=off
```
