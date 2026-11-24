# Healwright backend

The Healwright backend is a Spring Boot application distributed as one executable jar. It provides the healing API, PostgreSQL persistence, the embedded dashboard, telemetry aggregation, and journaled source rewriting.

## Requirements

- Java 21.
- PostgreSQL. PostgreSQL 13.0 was verified locally; other versions are not yet verified.
- No Docker is required to run the backend. Docker is used only by the Testcontainers test suite.

## Build

```bash
./gradlew clean test bootJar --no-daemon
```

The executable jar is written to `build/libs/healwright-backend-3.5.1.jar`.

## Run

```bash
export SPRING_POSTGRES_DB_HOST=localhost
export SPRING_POSTGRES_DB_PORT=5432
export SPRING_POSTGRES_DB=healwright
export SPRING_POSTGRES_SCHEMA=healwright
export SPRING_POSTGRES_USER=healwright_user
export SPRING_POSTGRES_PASSWORD='<your-password>'
export HEALWRIGHT_REPORT_DIR="$PWD/.healwright/reports"
export HEALWRIGHT_APPLY_ROOTS="$PWD"
export LOG_PATH="$PWD/logs"

java -jar build/libs/healwright-backend-3.5.1.jar
```

Open <http://localhost:7878/>. Verify the service with:

```bash
curl --fail http://localhost:7878/actuator/health
curl --fail http://localhost:7878/api/config
```

## Required security setting

`SPRING_POSTGRES_PASSWORD` is mandatory. The application has no password fallback. Rotate any credential that used an older default before deployment.

The dashboard and API do not provide application authentication. Keep the service local or protect it with an audited authenticated TLS reverse proxy.

## Default launcher profile

For a fresh installation, `npx healwright-backend` defaults to port `7878`, PostgreSQL at `localhost:5432`, database and schema `healwright`, user `healwright_user`, metrics disabled, the caller's `.healwright/reports` directory, and `HEALWRIGHT_APPLY_ROOTS="$PWD"`. Only `SPRING_POSTGRES_PASSWORD` is required. Every default can be overridden through its environment variable.

## Source rewriting

The client rewrites safely healed locators automatically by default. The backend writes only when `HEALWRIGHT_APPLY_ROOTS` contains the Playwright project root. The standard `healwright-backend` npm launcher sets this allowlist to the current project directory. Every applied rewrite is journaled and can be reverted; report-only sessions never write source.

## License

This distribution is a modified build of the EPAM Healenium backend 3.5.1. It remains under Apache-2.0. See `NOTICE` and `LICENSE` in this directory.
