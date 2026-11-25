import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  timeout: 40_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath: process.env.FOLIO_CHROMIUM || undefined },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
