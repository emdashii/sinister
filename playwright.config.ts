import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks. `bun run e2e` builds nothing itself: run `bun run build` first, since
 * the offline test needs the production service worker. The spike runs against the dev
 * server because its page is not part of the build.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  timeout: 300_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:4173", trace: "off" },
  webServer: [
    { command: "bun run preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: true },
    { command: "bun run dev --port 4174 --strictPort", url: "http://localhost:4174/spike/", reuseExistingServer: true },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
