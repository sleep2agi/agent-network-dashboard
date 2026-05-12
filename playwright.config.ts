import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: process.env.TEST_URL || 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'COMMHUB_URL=http://localhost:9999 ANET_DASHBOARD_PASSWORD=admin123 npm run dev',
    port: 3000,
    timeout: 60000,
    reuseExistingServer: true,
  },
});
