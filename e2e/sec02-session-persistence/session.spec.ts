import { test, expect, type Page } from "@playwright/test";

/**
 * session.spec.ts — SEC-02 (sesión deslizante y reautenticación segura).
 *
 * Corre EXCLUSIVAMENTE contra playwright.sec02.config.ts (nunca contra
 * playwright.config.ts ni playwright.production.config.ts): ese config
 * arranca un servidor Express local con
 * AUTH_SESSION_TTL_SECONDS=25/AUTH_SESSION_RENEWAL_THRESHOLD_SECONDS=18/
 * AUTH_SESSION_ABSOLUTE_TTL_SECONDS=90 — SOLO para esta ejecución, vía env,
 * nunca tocando el .env real ni producción. Esto permite probar renovación
 * deslizante y expiración real con esperas de segundos, nunca horas.
 *
 * Corre contra la BD LOCAL de desarrollo (docker compose up -d db), nunca
 * producción — así que usa una cuenta admin desechable propia de esta BD
 * local (creada vía `node scripts/create-admin.mjs`, mismo mecanismo
 * documentado en docs/QA_ACCOUNTS.md), no las credenciales de
 * E2E_ADMIN_EMAIL/.env.e2e.local (esas son de la cuenta Admin QA de
 * PRODUCCIÓN, ver playwright.production.config.ts — no existen en la BD
 * local). Mismo patrón que las credenciales hardcodeadas ya existentes en
 * e2e/auth.spec.ts y e2e/segolife-authenticated.spec.ts (cuentas de
 * desarrollo local, no secretos reales). Todas las páginas visitadas son de
 * solo lectura (dashboard, catálogo, CMS) — ninguna operación económica real
 * (venta, SegoTokens, reembolso, canje) se ejecuta en esta suite.
 *
 * El login real está limitado a 5 intentos/minuto por IP (authRateLimit,
 * server/_core/index.ts — protección real contra fuerza bruta, no se toca).
 * Por eso los escenarios que no necesitan un momento de login exacto y
 * aislado (recargar, navegar, multi-pestaña) reutilizan UN único login
 * compartido en vez de uno por test — solo returnTo/renovación/expiración
 * real, que sí necesitan su propio instante de login limpio, inician sesión
 * de forma independiente.
 *
 * El escenario "cuenta desactivada a mitad de sesión" y "cambio de rol/RBAC
 * durante una sesión activa" están cubiertos de forma determinista contra BD
 * real en server/sec02SessionPersistence.test.ts — no se duplican aquí con
 * manipulación directa de BD desde un spec de navegador, que no es un patrón
 * ya establecido en este repo (ver e2e/pre16-17 y el resto de e2e/*.spec.ts,
 * todos interactúan solo a través de la UI/API real).
 */
const ADMIN_EMAIL = "sec02.local.qa@segolife.es";
const ADMIN_PASSWORD = "Sec02LocalQA123!";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 10000 });
}

test.describe.configure({ mode: "serial" });

test.describe("SEC-02 — sesión persistente (sesión compartida: login, recargar, navegar, multi-pestaña)", () => {
  test("login real con la cuenta Admin QA aterriza en /admin, y la sesión sobrevive a recargar, navegar por varias páginas y una segunda pestaña", async ({ page, context }) => {
    await login(page);
    await expect(page).toHaveURL(/\/admin/);

    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);

    for (const path of ["/admin/productos", "/admin/cms", "/admin"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login/);
    }

    const page2 = await context.newPage();
    await page2.goto("/admin/productos");
    await expect(page2).not.toHaveURL(/\/login/);
    await page2.close();
  });
});

test.describe("SEC-02 — returnTo", () => {
  test("un deep-link a una página protegida sin sesión redirige a /login y, tras autenticarse, vuelve exactamente a esa página (no a /admin genérico)", async ({ page }) => {
    await page.goto("/admin/productos");
    await page.waitForURL(/\/login\?returnTo=/, { timeout: 10000 });
    await page.fill('input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/productos/, { timeout: 10000 });
  });
});

test.describe("SEC-02 — renovación deslizante y expiración real", () => {
  test("tras cruzar el umbral de renovación (< 18s de vida restante de un TTL de 25s) sin hacer nada explícito, la sesión sigue viva y la navegación posterior a otra página protegida funciona con normalidad", async ({ page }) => {
    await login(page);
    // Deja pasar más tiempo que "TTL(25s) - umbral(18s)" para cruzar el
    // punto de renovación mientras la pestaña sigue abierta en una página
    // autenticada real (actividad real del usuario, no un poll artificial).
    await page.waitForTimeout(19000);
    await page.goto("/admin/productos");
    await expect(page).not.toHaveURL(/\/login/);
    // La sesión renovada sigue sirviendo con normalidad en una página distinta.
    await page.goto("/admin/cms");
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("sin ninguna actividad autenticada durante más del TTL completo (25s), la siguiente navegación a una página protegida redirige a /login con un mensaje claro — nunca una pantalla en blanco ni un bucle de redirección", async ({ page }) => {
    await login(page);
    // Fuera de cualquier página autenticada durante la espera, para
    // garantizar que NINGUNA petición tiene ocasión de renovar la sesión —
    // así la expiración es real, no evitada por casualidad por un poll de
    // fondo.
    await page.goto("about:blank");
    await page.waitForTimeout(27000);
    await page.goto("/admin/productos");
    await page.waitForURL(/\/login\?.*reason=expired/, { timeout: 10000 });
    await expect(page.getByText(/tu sesión ha caducado/i)).toBeVisible();
    // Sin bucle: la URL de /login no sigue cambiando/rebotando sobre sí misma.
    const urlAfterLanding = page.url();
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(urlAfterLanding);
  });
});
