---
layout: default
title: Project story
---

# Project story

## From a consulting problem to local test resilience

Healwright began during a **client consulting assignment** focused on stabilizing flaky Playwright regression suites. Every application release could change the DOM: an identifier disappeared, a class changed, an element moved, or an iframe was replaced. A locator that had been correct yesterday then failed today.

The impact went beyond a red test. Teams spent more engineering effort maintaining locators, automation costs increased, and delivery time was consumed by work that did not validate new application behavior. The problem was not Playwright itself; it was the gap between an exact locator stored in source code and an application interface that had evolved.

## The constraint: keep project data local

External healing services introduced a different set of concerns. LLM-based approaches could add token consumption, while confidentiality policies did not always permit test code or application data to leave the client environment. CI/CD restrictions made those concerns operational: a solution that works only when an external service is reachable may not fit a regulated pipeline.

The objective became a robust, industrializable alternative that could run locally, support automatic or semi-automatic workflows, and produce evidence for every repair. Healwright's core healing workflow does not require an LLM or an Internet connection once the client and backend dependencies are installed.

## The design thesis: measured evidence, not guesswork

Healwright combines a **machine-learning classification model** with **comparative HTML DOM analysis**. When a Playwright locator action fails, the client can collect candidate elements and available context, compare their signals, score their confidence, and send the measured information to the local backend.

The workflow is deliberately bounded:

1. The original Playwright action must fail before healing starts.
2. Candidate elements are compared using locator, DOM, and available context evidence.
3. A candidate must be sufficiently distinctive and meet the configured score cap.
4. A supported action is replayed once by default.
5. The decision, score, timing, replay result, and source position are recorded.
6. A safe measured source callsite can be rewritten automatically or after explicit confirmation.

This is not a promise to repair every locator. When candidates are ambiguous, confidence is insufficient, or evidence is not distinctive, Healwright can refuse. A refusal protects the test from being redirected to a plausible but incorrect element.

## Five product pillars

### 1. Intelligent locator healing and visual evidence

Healwright classifies a failed locator, proposes alternatives, compares their DOM signals, and records visual evidence. The objective is to explain why a candidate was accepted or refused, not merely return a new selector.

### 2. Iframe and dynamic DOM healing

Application interfaces change structurally. Healwright supports iframe recovery, structural changes, open shadow roots, CSS, XPath, and web-first assertions within documented boundaries. Closed shadow roots, combined iframe/shadow-DOM scenarios, and other known limits remain explicitly disclosed.

### 3. Source-code healing with reversible control

Runtime recovery addresses the current execution. Source healing addresses future executions by updating a safely measured locator callsite. Automatic writes are enabled by default but remain constrained:

- the backend must allow the source root;
- reporting must provide the measured session;
- the session must not be report-only;
- the callsite must be measured and unambiguous;
- every applied edit must be journaled and reversible.

Variables, missing positions, ambiguous occurrences, and files outside the allowlist are not rewritten automatically. Exact diffs, manual confirmation, and source restoration keep the workflow inspectable.

### 4. Telemetry and traceability

Local JSONL events connect the failure to its candidates, scores, decision, timing, replay outcome, and source position. This makes a repair reviewable after the test run instead of hiding it inside an opaque retry.

### 5. Reporting and analytics

The embedded dashboard organizes sessions, test files, healing attempts, healed and refused locators, captures, timings, and source changes. Teams can inspect a specific failure, compare files, and understand where maintenance pressure remains.

## What industrializable means here

Healwright does not treat the word *industrial* as a claim of perfection. In this project it means a workflow with:

- **measured defaults** — adaptive scoring, a 2-second action timeout, `scoreCap: 0.6`, and one recovery attempt;
- **bounded behavior** — refusal is a valid outcome when evidence is insufficient;
- **observability** — local telemetry and reporting explain what happened;
- **change control** — measured callsites, exact diffs, an allowlist, and reversible journals;
- **evidence discipline** — frozen benchmark expectations and disclosed deviations;
- **known limitations** — unsupported scenarios and unresolved regressions are documented rather than hidden.

The [acceptance-testing methodology](acceptance-testing.md) describes how the project evaluated those claims. The historical campaign aggregates, the final 0.2.1 benchmark, and the live TestMu AI verification are separate evidence sets and should not be combined into one success rate.

## Adopt it incrementally

Start with the [getting-started guide](getting-started.md), run the verified healing scenario, and inspect the local JSONL evidence. For an existing suite, begin with `reportOnly: true` to review proposals without replaying or rewriting source. Keep a clean source-control checkpoint, narrow the backend allowlist, and enable automatic rewriting only after reviewing the behavior in your own application.

The goal is not to eliminate all locator maintenance. It is to make necessary recovery measurable, reviewable, and reversible while preserving the right to refuse an unsafe repair.

## Community and license

Healwright is an independent Apache-2.0 project. Contributions, reproducible evaluations, and clearly documented issues are welcome through the [GitHub repository](https://github.com/zouhairElMa/Healwright). You can also connect with the [project author on LinkedIn](https://www.linkedin.com/in/zel2351/).

Playwright and Microsoft are trademarks of their respective owners. Healwright is not affiliated with or endorsed by Microsoft.
