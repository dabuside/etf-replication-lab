import { defineConfig } from '@playwright/test';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end tests drive the real built page in a real browser engine and
 * assert that switching the two inputs recomputes every panel.
 *
 * The chromium headless shell is pre-provisioned in this environment, so we
 * point at its binary directly instead of relying on Playwright's platform
 * installer. Tests serve dist/ over HTTP (same as production preview).
 */
const SHELL = join(
  homedir(),
  '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    launchOptions: { executablePath: SHELL },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
  },
});
