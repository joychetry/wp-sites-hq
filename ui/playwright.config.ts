import { defineConfig } from "@playwright/test";

// The UI against the mock core (e2e/mock-core.ts) on its own port.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:5180", viewport: { width: 1440, height: 900 } },
  webServer: { command: "npx vite --mode mock --port 5180 --strictPort", url: "http://localhost:5180", reuseExistingServer: true },
});
