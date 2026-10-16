import { defineConfig } from '@playwright/test';
const baseURL = `http://127.0.0.1:${process.env.PORT || 4173}`;
export default defineConfig({
  timeout: 60000,
  expect: { timeout: 15000 },
  testDir: './test/browser',
  use: { baseURL, browserName: 'chromium', viewport: { width: 480, height: 1000 } },
  webServer: { command: 'npm run preview', url: baseURL, reuseExistingServer: !process.env.CI },
  reporter: 'list'
});
