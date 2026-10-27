import { defineConfig } from "@playwright/test";

// A build of the UI against the mock core (e2e/mock-core.ts), on its own port.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // More than this and headless Chromium crashes now and then on a busy machine.
  workers: 4,
  // One retry covers a crashed renderer; axe and the checks themselves are deterministic.
  retries: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:5180", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "npx vite build --mode mock --outDir dist-mock --emptyOutDir && npx vite preview --outDir dist-mock --port 5180 --strictPort",
    url: "http://localhost:5180",
    reuseExistingServer: false,
  },
});
