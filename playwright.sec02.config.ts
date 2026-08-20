import { defineConfig, devices } from "@playwright/test";

/**
 * playwright.sec02.config.ts — SEC-02 (sesión deslizante y reautenticación
 * segura). Config DEDICADA para probar los tiempos reales de sesión en un
 * navegador Chromium real, contra un servidor local propio (nunca
 * producción — ver playwright.production.config.ts para eso, deliberadamente
 * intocado).
 *
 * Arranca DOS procesos, igual que el flujo de desarrollo normal (Express en
 * :3000 + Vite en :5173, ver vite.config.ts server.proxy), pero el proceso
 * de Express recibe AUTH_SESSION_TTL_SECONDS/AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS/
 * AUTH_SESSION_ABSOLUTE_TTL_SECONDS reducidos SOLO para esta ejecución vía
 * env — nunca se toca el .env real ni los valores de producción, así que
 * ninguna otra suite ni el servidor de desarrollo normal del usuario se ven
 * afectados. Esto permite probar renovación deslizante y expiración real sin
 * esperas de horas reales (nunca minutos/horas de sleep real innecesario).
 *
 * Requiere la cuenta admin local desechable usada por el spec — si no
 * existe, créala una vez con:
 *   ADMIN_EMAIL=sec02.local.qa@segolife.es ADMIN_PASS=Sec02LocalQA123! node scripts/create-admin.mjs
 */
export default defineConfig({
  testDir: "./e2e/sec02-session-persistence",
  timeout: 60000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      // Un arranque directo (sin --watch) en vez de "pnpm dev": bajo el
      // supervisor de procesos de Playwright en Windows, "tsx watch"
      // (chokidar + su propio árbol de procesos hijos) nunca llega a
      // arrancar el servidor real — Playwright solo ve la cabecera de pnpm
      // y agota el timeout esperando /api/health, aunque el mismo comando
      // funciona perfectamente en una terminal interactiva normal. No hace
      // falta hot-reload para un único run de test.
      command: "cross-env NODE_ENV=development npx tsx server/_core/index.ts",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        // Nunca los nombres de variables de producción reales fuera de esta
        // config — mismo mecanismo (readTtlEnv en server/localAuth.ts), solo
        // que aquí se fuerzan cortos a propósito.
        AUTH_SESSION_TTL_SECONDS: "25",
        AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS: "18",
        AUTH_SESSION_ABSOLUTE_TTL_SECONDS: "90",
      },
    },
    {
      command: "pnpm vite",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
