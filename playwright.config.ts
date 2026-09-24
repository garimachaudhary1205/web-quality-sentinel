import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Web Quality Sentinel.
 *
 * Design notes (useful for interviews):
 *  - `retries` are ON so a test that fails then passes is surfaced as "flaky"
 *    rather than silently green. The custom reporter records the retry count.
 *  - We register a custom JSON reporter alongside the HTML + list reporters.
 *    It persists one `RunSummary` per run into /history for trend analysis.
 *  - Cross-browser coverage (Chromium/Firefox/WebKit) plus a mobile emulation
 *    project proves the monitored sites work across engines and form factors.
 *  - No global baseURL: the Health Monitor targets many external sites, so
 *    each test navigates to absolute URLs from sites.config.ts.
 */
export default defineConfig({
  testDir: './tests',
  /* Fail the build on CI if test.only is committed. */
  forbidOnly: !!process.env.CI,
  /* Retries create the flaky signal; keep local retries too so history is
     meaningful when run on a laptop. */
  retries: process.env.CI ? 2 : 1,
  /* Opt out of parallelism inside a file but run files in parallel. */
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  /* Generous per-test timeout — external sites can be slow. */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./src/reporting/json-reporter.ts'],
  ],

  use: {
    /* Collect trace/screenshot/video only when retrying — cheap but useful. */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    /* Identify ourselves politely to monitored sites. */
    userAgent: 'WebQualitySentinel/1.0 (+https://github.com/) Playwright monitoring bot',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
