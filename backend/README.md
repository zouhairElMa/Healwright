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

## Source rewriting

Source rewriting is disabled unless `HEALWRIGHT_APPLY_ROOTS` contains the allowed Playwright project roots. Every applied rewrite is journaled and can be reverted.

## License

This distribution is a modified build of the EPAM Healenium backend 3.5.1. It remains under Apache-2.0. See `NOTICE` and `LICENSE` in this directory.
