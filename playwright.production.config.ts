import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.e2e.local" });

/**
 * PRE-16.17A — config dedicada para QA automatizado de navegador contra
 * PRODUCCIÓN real (https://www.segolife.es). Deliberadamente separada de
 * playwright.config.ts (que apunta a localhost:5173 vía webServer para el
 * e2e/*.spec.ts existente) — no se toca esa config ni esos specs.
 */
export default defineConfig({
  testDir: "./e2e/pre16-17",
  timeout: 45000,
  // 1 reintento: la propia producción real (no un stub) ocasionalmente
  // responde con lentitud transitoria bajo ráfaga de logins secuenciales de
  // este suite — confirmado varias veces esta fase que el mismo test pasa
  // limpio en aislamiento. Un reintento absorbe eso sin ocultar bugs reales
  // (ninguno de estos tests tiene efectos secundarios destructivos que se
  // acumulen al reintentar).
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "artifacts/pre16-17-browser/results.json" }]],
  use: {
    baseURL: "https://www.segolife.es",
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
