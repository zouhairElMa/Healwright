import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Reporters register their dir for dashboard discovery; keep that out of the real home.
    env: {
      HEALWRIGHT_REPORT_REGISTRY: join(tmpdir(), `hw-vitest-${process.pid}`, 'dirs.json'),
    },
  },
});