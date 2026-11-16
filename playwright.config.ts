import { defineConfig, devices } from '@playwright/test'

// Browser smoke tests (signed-out flows only: no credentials are stored in the repo).
// Run: npm run test:e2e   (set E2E_BASE_URL to test an already running or deployed instance)
const externalUrl = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: externalUrl || 'http://127.0.0.1:4173',
    locale: 'ar-EG',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: externalUrl
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4173 --host 127.0.0.1',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
})
