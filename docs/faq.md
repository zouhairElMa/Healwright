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

## Why is the default scoring value called `healenium`?

The string identifies the legacy scoring formula retained for compatibility. It is not the public product name and does not indicate a runtime dependency on a separate service. New configurations can use the equivalent `healwright` alias.

## How do I audit healing without applying it?

Set `reportOnly: true` or `HEALWRIGHT_REPORT_ONLY=true`.

## Does Healwright rewrite my tests automatically?

No. Source rewriting is disabled by default. It requires an explicit backend allowlist and can be run in dry-run mode first.

## Can I expose the dashboard on the Internet?

Not directly. The dashboard and API do not provide application authentication. Use an audited authenticated TLS reverse proxy.

## Which Playwright versions are supported?

The package declares Playwright 1.40 or newer. Local verification used 1.65.x. Major upgrades must be validated with the browser test suite.

## Where do I report a security issue?

Use [GitHub private vulnerability reporting](https://github.com/zouhairElMa/Healwright/security/advisories/new). Do not open a public issue.
