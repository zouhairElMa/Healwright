import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: {
      HEALWRIGHT_REPORT_REGISTRY: join(tmpdir(), `hw-vitest-int-${process.pid}`, 'dirs.json'),
    },
  },
});