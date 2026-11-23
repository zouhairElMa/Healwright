# Contributing to Healwright

Thank you for helping improve Healwright.

## Before starting

- Open an issue for significant changes.
- Keep the default scoring profile, `scoreCap: 0.6`, and F1-F5/F4b behavior unchanged unless the change is explicitly approved.
- Do not modify frozen benchmark evidence or pre-registration files.
- Preserve Apache-2.0, `LICENSE`, `NOTICE`, and upstream attributions.
- Do not commit secrets, logs, screenshots, build outputs, or machine-specific paths.

## Development

```bash
cd client
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:integration
npm run test:fixture
```

Backend:

```bash
cd backend
./gradlew test bootJar --no-daemon
```

The backend test suite uses Testcontainers and requires Docker. Docker is not required to run the backend jar.

## Pull requests

- Target `main`.
- Use English for code comments, documentation, issues, and pull requests.
- Add tests for behavior changes.
- Include the commands you ran and their results.
- Disclose benchmark deviations and any code changes made after measurement started.

## Code of conduct

Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
