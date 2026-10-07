import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// Browser tests: the real app in a phone-sized Chromium. `npm run e2e`.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }], ['./e2e/summary-reporter.js']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'phone', use: {} }],
  webServer: {
    command: `python scripts/serve.py ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
