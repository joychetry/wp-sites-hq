// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from "@playwright/test";

// A build of the UI against the mock core (e2e/mock-core.ts), on its own port (E2E_PORT, default 5180).
const port = Number(process.env.E2E_PORT ?? 5180);
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // More than this and headless Chromium crashes now and then on a busy machine.
  workers: 4,
  // One retry covers a crashed renderer; axe and the checks themselves are deterministic.
  retries: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `npx vite build --mode mock --outDir dist-mock --emptyOutDir && npx vite preview --outDir dist-mock --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
