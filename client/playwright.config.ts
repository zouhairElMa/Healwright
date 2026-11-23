import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/fixture',
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    headless: true,
    browserName: 'chromium',
  },
});