---
layout: default
title: Backend
---

# Backend

The backend is distributed as `healwright-backend-3.5.1.jar`. It contains the API, dashboard, license, and notice. No sidecar file or Docker container is required at runtime.

## Requirements

- Java 21.
- PostgreSQL. Version 13.0 was verified locally; other versions are not yet verified.

## Create the database

Run these commands with a PostgreSQL administration account and replace the password:

```bash
psql -h localhost -U postgres -c "CREATE USER healwright_user WITH PASSWORD 'CHANGE_ME';"
psql -h localhost -U postgres -c "CREATE DATABASE healwright OWNER healwright_user;"
```

Never reuse the example password.

## Configure and run

```bash
export SPRING_SERVER_PORT=7878
export SPRING_POSTGRES_DB_HOST=localhost
export SPRING_POSTGRES_DB_PORT=5432
export SPRING_POSTGRES_DB=healwright
export SPRING_POSTGRES_SCHEMA=healwright
export SPRING_POSTGRES_USER=healwright_user
export SPRING_POSTGRES_PASSWORD='<your-password>'
export HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"
export HEALWRIGHT_REPORT_REGISTRY="$HOME/.healwright/dirs.json"
export LOG_PATH="$PWD/logs"
export COLLECT_METRICS=false

java -jar healwright-backend-3.5.1.jar
```

`SPRING_POSTGRES_PASSWORD` is mandatory and has no fallback.

## Verify

```bash
curl --fail http://localhost:7878/actuator/health
curl --fail http://localhost:7878/api/config
```

Open <http://localhost:7878/>.

## Build from source

```bash
./gradlew clean test bootJar --no-daemon
```

The full test suite uses Testcontainers and requires Docker. The production jar does not require Docker.

## Environment variables

| Variable | Purpose |
|---|---|
| `SPRING_SERVER_PORT` | HTTP port, default `7878`. |
| `SPRING_POSTGRES_DB_HOST` | PostgreSQL host. |
| `SPRING_POSTGRES_DB_PORT` | PostgreSQL port, default `5432`. |
| `SPRING_POSTGRES_DB` | Database name. |
| `SPRING_POSTGRES_SCHEMA` | Schema name. |
| `SPRING_POSTGRES_USER` | Database user. |
| `SPRING_POSTGRES_PASSWORD` | Required database password. |
| `HEALWRIGHT_REPORT_DIR` | Primary telemetry directory. |
| `HEALWRIGHT_REPORT_REGISTRY` | Client directory registry. |
| `HEALWRIGHT_LOG_LEVEL` | Application log level. |
| `SPRING_LOG_LEVEL` | Root Spring log level. |
| `LOG_PATH` | Log directory. |
| `COLLECT_METRICS` | Metrics collection flag. |
| `HEALWRIGHT_APPLY_ROOTS` | Allowlisted source-rewrite roots. |

## Security

The dashboard and API do not provide application authentication. Do not expose them directly to the Internet. Remote access requires an audited authenticated TLS reverse proxy.

Back up PostgreSQL before a schema migration. Do not restore an older database automatically after Liquibase changes.
