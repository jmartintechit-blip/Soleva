import { defineConfig, devices } from '@playwright/test';

// The test reads DATABASE_URL (the same branch the app uses) from .env locally, from the job env in CI.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env in CI.
}

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  // One at a time: every test signs in as the same email, and a new code replaces the last one.
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  // CI runs in the US against the database in Frankfurt: a save, the engine run and the next page's
  // load take longer than the 5 s default there.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  // vite dev, not workerd: without RESEND_API_KEY it logs the code instead of emailing it.
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/entrar',
    reuseExistingServer: !process.env.CI,
  },
});
