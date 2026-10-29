// SPDX-License-Identifier: GPL-3.0-or-later
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and its own console output. `--mode mock`
// swaps the core for e2e/mock-core.ts so Playwright can run the UI in a browser.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  resolve:
    mode === "mock"
      ? { alias: { "@tauri-apps/api/core": "/e2e/mock-core.ts", "@tauri-apps/api/event": "/e2e/mock-core.ts" } }
      : undefined,
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
    // Teardown in registration order: screens unmount before a file's afterEach resets the invoke mock,
    // so a late effect never calls a bare mock (undefined.then).
    sequence: { hooks: "list" },
  },
}));
