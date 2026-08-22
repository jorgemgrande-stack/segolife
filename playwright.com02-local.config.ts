import { defineConfig, devices } from "@playwright/test";

/**
 * COM-02 — config dedicada para la verificación E2E LOCAL (contra
 * localhost:3000, servidor real `pnpm dev` + BD Docker local) del feed
 * social + comentarios. Deliberadamente separada de playwright.config.ts
 * (e2e/*.spec.ts legacy) y de playwright.production.config.ts (esa apunta a
 * producción real y solo hace smoke no destructivo) — mismo patrón de
 * projects desktop/mobile/tablet que production, pero contra local.
 */
export default defineConfig({
  testDir: "./e2e/com02",
  timeout: 45000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: /\.responsive\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true },
    },
    {
      name: "tablet",
      testMatch: /\.responsive\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
  ],
});
