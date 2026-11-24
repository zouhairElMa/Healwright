---
layout: default
title: Backend
---

# Backend

The backend is distributed as `healwright-backend-3.5.1.jar`. It contains the API, dashboard, license, and notice. No sidecar file or Docker container is required at runtime.

## Requirements

- Java 21.
- PostgreSQL. Version 13.0 was verified locally; other versions are not yet verified.

## Java 21 on macOS with Homebrew

If Java 21 is already registered with macOS, select it:

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

On Apple silicon Macs where `/usr/libexec/java_home -v 21` does not find the Homebrew JDK, use:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

On Intel Macs, the Homebrew prefix is normally `/usr/local/opt/openjdk@21`.

## Create the database

Run these commands with the PostgreSQL client tools. `createuser --pwprompt` asks for the password without placing it in shell history.

Fresh installation:

```bash
createuser --pwprompt healwright_user
createdb -O healwright_user healwright
psql -h localhost -U healwright_user -d healwright \
  -c "CREATE SCHEMA IF NOT EXISTS healwright AUTHORIZATION healwright_user;"
```

Existing legacy installation: keep the current role, database, and schema. Set the three corresponding environment variables to the existing values instead of creating duplicates:

```bash
export SPRING_POSTGRES_DB=healenium
export SPRING_POSTGRES_SCHEMA=healenium
export SPRING_POSTGRES_USER=healenium_user
```

These names are database identifiers retained for compatibility, not Healwright product branding.

## Configure and run

Run the backend from the Playwright project root so the rewrite allowlist and report directory point to the project that contains the tests.

Fresh installation:

```bash
cd /path/to/your/playwright-project

export SPRING_SERVER_PORT=7878
export SPRING_POSTGRES_DB_HOST=localhost
export SPRING_POSTGRES_DB_PORT=5432
export SPRING_POSTGRES_DB=healwright
export SPRING_POSTGRES_SCHEMA=healwright
export SPRING_POSTGRES_USER=healwright_user
export SPRING_POSTGRES_PASSWORD='<your-password>'
export HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"
export HEALWRIGHT_APPLY_ROOTS="$PWD"
export HEALWRIGHT_REPORT_REGISTRY="$HOME/.healwright/dirs.json"
export LOG_PATH="$PWD/logs"
export COLLECT_METRICS=false

java -jar /path/to/healwright-backend-3.5.1.jar
```

`SPRING_POSTGRES_PASSWORD` is mandatory and has no fallback. Never commit it.

For a fresh installation, the npm launcher defaults to port `7878`, PostgreSQL at `localhost:5432`, database and schema `healwright`, user `healwright_user`, metrics disabled, `HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"`, and `HEALWRIGHT_APPLY_ROOTS="$PWD"`. Only the password is required:

```bash
export SPRING_POSTGRES_PASSWORD='<your-password>'
npx healwright-backend --jar /path/to/healwright-backend-3.5.1.jar
```

You can still set `HEALWRIGHT_APPLY_ROOTS` explicitly when the tests are in a different directory. Multiple roots use the platform path separator (`:` on macOS and Linux, `;` on Windows). Keep the allowlist as narrow as possible.

## Verify

```bash
curl --fail http://localhost:7878/actuator/health
curl --fail http://localhost:7878/api/config
```

Expected health response:

```json
{"groups":["liveness","readiness"],"status":"UP"}
```

Open <http://localhost:7878/>.

## Source rewriting

The client rewrites safely healed locators automatically by default. The backend writes only when `HEALWRIGHT_APPLY_ROOTS` contains the Playwright project root. The npm launcher sets this allowlist for you; the direct `java -jar` command must export it explicitly.

Writes are atomic, journaled, and reversible. Files outside the allowlist, ambiguous targets, variables, unmeasured occurrences, and report-only sessions are not rewritten automatically.

```bash
npx healwright-rewrite status
npx healwright-rewrite list
npx healwright-rewrite apply --dry-run
npx healwright-rewrite revert --scope last
```

See [source rewriting](rewriting.md) for details.

## Troubleshooting

### `role "healwright_user" does not exist`

The environment points to a role that was not created. Create it, or set `SPRING_POSTGRES_USER` to the existing role. For the legacy local installation, that role is `healenium_user`.

### `java -version` is not 21

Set `JAVA_HOME` and prepend its `bin` directory to `PATH` as shown above. The backend requires Java 21.

### `Writing is disabled on the backend`

The backend was started without a valid `HEALWRIGHT_APPLY_ROOTS` directory. Restart it from the Playwright project root with:

```bash
export HEALWRIGHT_APPLY_ROOTS="$PWD"
java -jar /path/to/healwright-backend-3.5.1.jar
```

Or use `npx healwright-backend`, which sets the allowlist automatically. Healing and replay still work when rewriting is disabled; only source writing is refused.

### Health check fails

Confirm PostgreSQL is running, the password is correct, and the database, schema, and role names match the environment. Do not print or paste the password into logs or issue reports.

## Build from source

```bash
./gradlew clean test bootJar --no-daemon
```

The full test suite uses Testcontainers and requires Docker. The production jar does not require Docker.

## Environment variables

| Variable | Purpose |
|---|---|
| `SPRING_SERVER_PORT` | HTTP port; launcher default `7878`. |
| `SPRING_POSTGRES_DB_HOST` | PostgreSQL host; launcher default `localhost`. |
| `SPRING_POSTGRES_DB_PORT` | PostgreSQL port; launcher default `5432`. |
| `SPRING_POSTGRES_DB` | Database name; launcher default `healwright`. |
| `SPRING_POSTGRES_SCHEMA` | Schema name; launcher default `healwright`. |
| `SPRING_POSTGRES_USER` | Database user; launcher default `healwright_user`. |
| `SPRING_POSTGRES_PASSWORD` | Required database password; no fallback. |
| `HEALWRIGHT_REPORT_DIR` | Primary telemetry directory; launcher default `<cwd>/.healwright/reports`. |
| `HEALWRIGHT_REPORT_REGISTRY` | Client directory registry. |
| `HEALWRIGHT_APPLY_ROOTS` | Allowlisted source-rewrite roots; launcher default `<cwd>`. Required for writes. |
| `HEALWRIGHT_REWRITE_JOURNAL` | Optional rewrite journal directory. |
| `HEALWRIGHT_LOG_LEVEL` | Application log level. |
| `SPRING_LOG_LEVEL` | Root Spring log level. |
| `LOG_PATH` | Log directory. |
| `COLLECT_METRICS` | Metrics collection flag; launcher default `false`. |

## Security

The dashboard and API do not provide application authentication. Do not expose them directly to the Internet. Remote access requires an audited authenticated TLS reverse proxy.

Back up PostgreSQL before a schema migration. Do not restore an older database automatically after Liquibase changes.
