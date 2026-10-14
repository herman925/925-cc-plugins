import { defineConfig } from '@playwright/test';
export default defineConfig({
  timeout: 60000,
  expect: { timeout: 15000 },
  testDir: './test/browser',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', viewport: { width: 480, height: 1000 } },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  reporter: 'list'
});
