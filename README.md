# Healwright

Healwright adds self-healing locators and resilient tests to Playwright. It runs the healing engine inside the Playwright process and uses a local Java backend for persistence, reporting, and source rewriting.

The backend and dashboard are distributed as one executable jar. Docker is not required to run the backend.

## Features

- Replays a failed Playwright action once against a healed locator.
- Supports CSS and XPath selectors.
- Heals locators in pages, open shadow roots, and iframes.
- Supports web-first Playwright assertions.
- Provides an embedded reporting dashboard.
- Records candidates, scores, timings, screenshots, and replay outcomes.
- Offers `reportOnly` mode for auditing proposals without applying them.
- Supports explicit, journaled source rewriting with revert operations.
- Keeps the legacy scoring profile as the default for compatibility.

## Requirements

- Node.js 20 or newer.
- Playwright and `@playwright/test` 1.40 or newer. The verified range is 1.65.x.
- Java 21 for the backend.
- PostgreSQL accessible to the backend. PostgreSQL 13.0 was verified locally; other versions are not yet verified.

## Installation

```bash
npm install @zouhair/healwright
npm install -D playwright @playwright/test
npx playwright install chromium
```

## Start the backend

Download `healwright-backend-3.5.1.jar` from the [GitHub Releases page](https://github.com/zouhairElMa/Healwright/releases), create a PostgreSQL database, and set the required environment variables.

```bash
export SPRING_POSTGRES_DB_HOST=localhost
export SPRING_POSTGRES_DB_PORT=5432
export SPRING_POSTGRES_DB=healwright
export SPRING_POSTGRES_SCHEMA=healwright
export SPRING_POSTGRES_USER=healwright_user
export SPRING_POSTGRES_PASSWORD='<your-password>'
export HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"

java -jar healwright-backend-3.5.1.jar
```

The dashboard is available at <http://localhost:7878/>. The health endpoint is <http://localhost:7878/actuator/health>.

You can also start the jar through the npm CLI:

```bash
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
npx healwright-doctor
```

See the [backend guide](docs/backend.md) for all environment variables and security requirements.

## Quick start

### Programmatic API

```ts
import { chromium } from 'playwright';
import { heal } from '@zouhair/healwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://example.com');

const healedPage = heal(page, { serverUrl: 'http://localhost:7878' });
await healedPage.locator('#submit').click();

await browser.close();
```

### Playwright fixture

```ts
import { test, expect } from '@zouhair/healwright/test';

test.use({ healOptions: { serverUrl: 'http://localhost:7878' } });

test('submits after a locator change', async ({ healedPage }) => {
  await healedPage.locator('#submit').click();
  await expect(healedPage.locator('#submit')).toBeVisible();
});
```

An element that exists but is not actionable is not healed. In `reportOnly` mode, Healwright records proposals without replaying the action.

## Configuration

Configuration precedence is **user option > environment variable > default**.

| Option | Environment variable | Default |
|---|---|---|
| `healEnabled` | `HEALWRIGHT_HEAL_ENABLED` | `true` |
| `scoreCap` | `HEALWRIGHT_SCORE_CAP` | `0.6` |
| `recoveryTries` | `HEALWRIGHT_RECOVERY_TRIES` | `1` |
| `serverUrl` | `HEALWRIGHT_SERVER_URL` | `http://localhost:7878` |
| `selectorType` | `HEALWRIGHT_SELECTOR_TYPE` | `css` |
| `reportOnly` | `HEALWRIGHT_REPORT_ONLY` | `false` |
| `reportDir` | `HEALWRIGHT_REPORT_DIR` | `<cwd>/.healwright/reports` |
| `scoring` | `HEALWRIGHT_SCORING` | `healenium` (legacy profile) |
| `sourceRewrite` | `HEALWRIGHT_SOURCE_REWRITE` | `off` |

The string `healenium` is retained only as the legacy scoring-profile identifier. It is not the public product name. See [configuration](docs/configuration.md) for the complete list.

## Reporting and source rewriting

Each session writes JSONL telemetry under `reportDir`. The backend reads that directory and directories registered by the client in `~/.healwright/dirs.json`.

```bash
npx healwright-report --backend http://localhost:7878 --port 7879
npx healwright-rewrite list
npx healwright-rewrite apply --dry-run
npx healwright-rewrite apply --all
npx healwright-rewrite revert --scope last
```

Source rewriting is disabled by default. It requires an explicit backend allowlist through `HEALWRIGHT_APPLY_ROOTS` and always creates a reversible journal.

## Documentation

- [Getting started](docs/getting-started.md)
- [API](docs/api.md)
- [Configuration](docs/configuration.md)
- [Reporting](docs/reporting.md)
- [Source rewriting](docs/rewriting.md)
- [Backend](docs/backend.md)
- [Known limitations](docs/limitations.md)
- [Migration](docs/migration.md)
- [Security](docs/security.md)
- [FAQ](docs/faq.md)
- [Changelog](docs/CHANGELOG.md)

## Security

The backend dashboard and API do not provide application authentication. Keep the backend on a trusted local network. Do not expose it directly to the Internet without an audited authenticated TLS reverse proxy.

Never commit PostgreSQL passwords, npm tokens, GitHub tokens, or `.env` files. Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/zouhairElMa/Healwright/security/advisories/new).

## License

Healwright is licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for upstream attributions and modifications.
