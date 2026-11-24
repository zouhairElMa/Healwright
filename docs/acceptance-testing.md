---
layout: default
title: Acceptance testing
---

# Acceptance testing

Healwright is evaluated as a recovery system, not as an unconditional locator generator. An acceptance result must connect the original failure to candidate evidence, a confidence decision, a controlled replay, and the final Playwright assertion. A refusal is reported separately from a successful repair.

## Evidence boundaries

The project has three distinct evidence sets:

| Evidence set | Scope | Reported result | Interpretation |
|---|---|---|---|
| Historical acceptance campaign | 640 executions and 815 healing attempts | 712 healed, 103 refused, 87.4% measured healing success | Historical campaign aggregates using a Three-Point Estimation frame and ISTQB-aligned scenarios |
| Final 0.2.1 benchmark | 128 preregistered benchmark cases | 119 passed, 9 failed | Exact rc.8 correspondence was required but not achieved; 35 failures became passes and IF-04 regressed |
| Live 0.2.1 verification | Public TestMu AI mutation scenario | 4 successful heals and 4 `replay.ok` events | Verified packaged defaults, automatic source rewrite, and byte-identical revert |

These sets have different denominators and purposes. The historical healing acceptance rate must not be presented as the final benchmark pass rate. The raw public evidence linked below covers the final benchmark and live scenario; the historical figures are reported as campaign aggregates.

## Three-Point Estimation

The historical evaluation used optimistic, most likely, and pessimistic estimates for the **non-healing rate**:

| Symbol | Meaning | Estimate |
|---|---|---:|
| `a` | Optimistic non-healing rate | 0% |
| `m` | Most likely non-healing rate | 50% |
| `b` | Pessimistic non-healing rate | 100% |

The expected value and standard deviation are:

```text
E = (a + 4 × m + b) / 6
E = (0 + 4 × 50 + 100) / 6
E = 50%

SD = (b - a) / 6
SD = (100 - 0) / 6
SD = 16.67 percentage points
```

The estimate was therefore **50% non-healing ± 16.67 percentage points**. This is a theoretical planning estimate, not a measured confidence interval and not a substitute for the observed campaign results.

## Healing acceptance rate

The campaign measured acceptance as:

```text
Acceptance Rate = Healed / (Healed + Refused)
Acceptance Rate = 712 / (712 + 103)
Acceptance Rate = 712 / 815
Acceptance Rate ≈ 87.4%
```

The initial target was an acceptance rate **above 67%**. The measured 87.4% result was **20.4 percentage points above** that target.

## Historical acceptance campaign

The campaign increased test density beyond 800 healing attempts and combined ISTQB-aligned practices with Three-Point Estimation. Its purpose was to evaluate healing behavior across representative mutation categories, including dynamic DOM and frame scenarios, while preserving refused cases as explicit outcomes.

| Metric | Historical campaign result |
|---|---:|
| Executions | 640 |
| Healing attempts | 815 |
| Healed attempts | 712 |
| Refused attempts | 103 |
| Measured success rate | 87.4% |
| Margin above the initial 67% target | 20.4 percentage points |
| Average score | 0.88 |
| Average healing time | 145 ms |
| Healing operations disabled | 0 |

### Historical IF-03 example

| Case | Attempts | Successful repairs | Success rate | Average score | Average healing time |
|---|---:|---:|---:|---:|---:|
| IF-03 | 2 | 2 | 100% | 0.79 | 82 ms |

IF-03 is a small historical example, not a general guarantee for iframe healing. The final benchmark independently disclosed a nested-frame regression in IF-04.

## Why refusal is part of acceptance

Healwright should not turn an uncertain candidate into an apparently green test. A refusal is expected when:

- two or more candidates remain ambiguous;
- no candidate is distinctive enough;
- the best candidate does not meet the configured score cap;
- available evidence is missing or insufficient;
- the scenario is outside the documented healing boundaries.

The final benchmark telemetry recorded adaptive refusals and no-evidence outcomes. These outcomes remain visible in the evidence and the dashboard. They are not silently counted as healed attempts.

## Testing workflow

### 1. Define the scenario and its boundary

Record the mutation, original locator, expected target, supported action, DOM context, and any frame or shadow-root boundary. Separate a locator mutation from an element that exists but is not actionable.

### 2. Freeze inputs and expected outcomes

Before measurement, record the package version and checksum, backend checksum, browser version, configuration, benchmark source hashes, and the expected status of every case. A frozen preregistration prevents a post-run change from being presented as an originally expected result.

### 3. Separate baseline and candidate runs

Use the same browser, worker count, retries, timeout settings, and application fixture. Run the frozen baseline and candidate under comparable conditions. Do not change benchmark inputs to make a failure disappear.

### 4. Prepare isolated reporting state

Use a fresh isolated PostgreSQL schema and a dedicated report directory. Do not delete existing data or overwrite an existing evidence bundle. Record the schema, report location, and starting selector count.

### 5. Execute and capture telemetry

Capture Playwright outcomes together with local JSONL events. Preserve the original failure, candidate list, scoring mode, confidence values, decision, timings, and replay result.

### 6. Validate the replay, not only the proposal

A proposed locator is not enough. The supported action must be replayed within the configured recovery limit, and the test assertion must then pass. Record `replay.ok` and `heal.success` events where applicable.

### 7. Evaluate source rewriting separately

For a frozen benchmark, disable automatic source edits so one case cannot change the input for the next. Verify the packaged automatic-rewrite default separately through a live scenario, then inspect the journal and restore the original bytes.

### 8. Review every refusal

Classify refusals as ambiguity, insufficient confidence, missing evidence, no candidate above the cap, or an unsupported boundary. A refusal can be correct safety behavior; it can also reveal missing evidence or a regression that needs a new preregistered evaluation.

### 9. Classify deviations from the frozen baseline

Report cases that remained unchanged, improved from failed to passed, or regressed from passed to failed. Preserve unexpected regressions and diagnostic runs. Do not fill or rewrite the human verdict after measurement.

### 10. Apply a release gate

A release note must state the exact outcome, deviations, unresolved cases, known limitations, and external gates. A higher aggregate pass count does not erase an unexpected regression.

## Final 0.2.1 benchmark

The final benchmark used the packaged production scoring and action-timeout defaults with no explicit scoring or action-timeout override. It ran Chromium headlessly, one worker, no retries, a 30-second test timeout, and a 3-second assertion timeout. `sourceRewrite: 'off'` was a benchmark-isolation override; automatic rewriting was verified separately.

| Measure | Frozen rc.8 baseline | Final 0.2.1 result |
|---|---:|---:|
| Total cases | 128 | 128 |
| Passed | 85 | 119 |
| Failed | 43 | 9 |
| Exact per-case correspondence | Required | Not achieved |
| Cases unchanged | — | 92 |
| Failed → passed | — | 35 |
| Passed → failed | — | 1 |

The acceptance status is **`NOT_ACCEPTED_EXACT_MATCH`**. The aggregate improved, but the frozen rule required exact per-case outcomes and no unexpected regressions.

The nine failed cases are **L2-06, IF-04, IF-05, IF-06, IF-07, IF-08, SH-04, SH-08, and MultiGen**. Some were already known boundaries in the baseline; IF-04 is the unexpected pass-to-fail regression.

### IF-04 diagnostic

IF-04 was rerun after measurement in a separate fresh schema. It failed reproducibly: the outer frame healed, while the inner frame was refused with adaptive no-evidence signals and empty context. The diagnostic did not change product or benchmark code. IF-04 remains unresolved.

Evidence files:

- [Frozen final benchmark preregistration](https://github.com/zouhairElMa/Healwright/blob/main/docs/evidence/final-0.2.1-benchmark-preregistration.json)
- [Structured final benchmark results](https://github.com/zouhairElMa/Healwright/blob/main/docs/evidence/final-0.2.1-benchmark-results.json)
- [Final benchmark log](https://github.com/zouhairElMa/Healwright/blob/main/docs/evidence/final-0.2.1-benchmark.log)
- [IF-04 diagnostic log](https://github.com/zouhairElMa/Healwright/blob/main/docs/evidence/final-0.2.1-if04-diagnostic.log)

The benchmark JSON records the frozen input hashes, configuration, telemetry counts, database state, per-case outcomes, and post-measurement diagnostic. The telemetry contained 127 sessions, 670 events, 130 `heal.success` events, and 111 `replay.ok` events. These event counts are not the benchmark pass-rate denominator.

## Live verification with packaged defaults

The public TestMu AI scenario mutates `#username` to `#lambdatest`. The packaged 0.2.1 verification recorded:

- 4 `heal.success` events;
- 4 `replay.ok` events for `#lambdatest`;
- adaptive scoring without an explicit scoring override;
- the 2,000 ms packaged action timeout without an explicit timeout override;
- one automatic rewrite transaction applying 4 measured callsites and skipping 1;
- a journal-based revert restoring 4 callsites with no conflicts and byte-identical source.

This verifies the documented live scenario and rewrite lifecycle. It does not replace the 128-case benchmark or remove its failures.

Evidence files:

- [Live verification summary](https://github.com/zouhairElMa/Healwright/blob/main/docs/evidence/live-testmuai-0.2.1-defaults.json)
- [Live verification telemetry](https://github.com/zouhairElMa/Healwright/blob/main/docs/evidence/live-testmuai-0.2.1-defaults.jsonl)
- [Live verification log](https://github.com/zouhairElMa/Healwright/blob/main/docs/evidence/live-testmuai-0.2.1-defaults.log)

Follow the [verified live scenario](getting-started.md#4-add-the-verified-live-test) to repeat the mutation. Restore the previous source with `healwright-rewrite revert --scope last` before repeating it after an automatic rewrite.

## Release evidence for 0.2.2

Version 0.2.2 changes publication assets and documentation only. Its packaged `dist/` directory is byte-identical to 0.2.1, and the production defaults remain:

```json
{"scoring":"adaptive","actionTimeout":2000,"scoreCap":0.6,"sourceRewrite":"auto"}
```

The final benchmark and live verification therefore remain applicable to the runtime. No new live benchmark or new healing success rate is claimed for 0.2.2.

## Known limitations and external gates

- Closed shadow roots and slots are not healed.
- Combined iframe and shadow-DOM scenarios are not fully supported.
- Chained `getBy*` locators on a `Locator` are not fully supported.
- Negated assertions and found-but-not-matching assertion failures are not healed.
- An element that exists but is not actionable is not healed.
- Assertion healing depends on Playwright's internal `locator._expect` protocol.
- PostgreSQL 13.0 was verified locally; other versions are not yet verified.
- Testcontainers and remote/production PostgreSQL remain unverified external gates.
- Billing-dependent GitHub Actions checks remain blocked.
- The backend dashboard and API do not provide application authentication.

See [Known limitations](limitations.md) and [Security](security.md) for the operational boundaries. Use `reportOnly` for read-only evaluation and keep a clean source-control checkpoint before enabling source writes.
