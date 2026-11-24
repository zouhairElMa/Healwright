---
layout: default
title: FAQ
---

# Frequently asked questions

## What is the npm package name?

The package is `@zouhair_elmattad/healwright`.

## Is the backend included in the npm package?

No. The npm package contains the Playwright client and CLI tools. The backend is distributed separately as `healwright-backend-3.5.1.jar`.

## Do I need Docker?

No. Docker is not required to run the backend. It is used only by the Testcontainers backend test suite.

## Which scoring profile is used by default?

`adaptive` is the default because it produced the best measured results on the frozen benchmark, including safe refusals for ambiguous and negative-control cases. The legacy `healenium` profile and its equivalent `healwright` alias remain available for compatibility; `improved` remains available for controlled evaluations. The default `scoreCap` is still `0.6`.

## How do I audit healing without applying it?

Set `reportOnly: true` or `HEALWRIGHT_REPORT_ONLY=true`.

## Does Healwright rewrite my tests automatically?

Yes, for safely healed measured string-literal callsites. The backend must still be started with `HEALWRIGHT_APPLY_ROOTS` set to the Playwright project root; the standard `healwright-backend` launcher sets it to the current directory. Every write is journaled and reversible. Set `sourceRewrite: 'off'` to disable automatic writes, or use `reportOnly: true` to audit without replaying or rewriting.

## Can I expose the dashboard on the Internet?

Not directly. The dashboard and API do not provide application authentication. Use an audited authenticated TLS reverse proxy.

## Which Playwright versions are supported?

The package declares Playwright 1.40 or newer. Local verification used 1.65.x. Major upgrades must be validated with the browser test suite.

## Where do I report a security issue?

Use [GitHub private vulnerability reporting](https://github.com/zouhairElMa/Healwright/security/advisories/new). Do not open a public issue.
