import { defineConfig } from '@playwright/test';

// No authentication or remote API: the real UI/save handlers use local fixtures.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'record-modal-layout.spec.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/record-modals',
  use: {
    baseURL: 'http://127.0.0.1:5188',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tests/manual/record-modal-fixture-server.cjs',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'large-phone', use: { viewport: { width: 720, height: 900 }, isMobile: true, hasTouch: true } },
    { name: 'ipad', use: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true } }
  ]
});
