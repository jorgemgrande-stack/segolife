import { test, expect } from "@playwright/test";

/**
 * Fase 6 — routing dinámico de comunidad y guardas de autenticación.
 * No requiere sesión ni datos de fixture: solo prueba el ROUTING/SHELL,
 * nunca un canje real ni datos de negocio. Necesita el backend real
 * corriendo (mismo supuesto que el resto de e2e/*.spec.ts — arrancar
 * `pnpm dev` antes de `pnpm test:e2e`).
 */
test.describe("Segolife — routing de comunidad", () => {
  test("una comunidad real (/ie) carga la app Segolife, nunca la home heredada de Náyade", async ({ page }) => {
    await page.goto("/ie");
    // Sin sesión, las rutas personales redirigen a login (ver SegolifeAppShell, requireAuth) —
    // confirma que la Home nueva NUNCA se sirve sin autenticar, y que no aparece contenido Náyade.
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test("un slug de comunidad inexistente muestra 'Community not found', nunca cae en IE/UVA por defecto", async ({ page }) => {
    await page.goto("/comunidad-que-no-existe");
    await expect(page.getByText(/community not found|comunidad no encontrada/i)).toBeVisible({ timeout: 8000 });
  });

  test("/:community/scan sin sesión redirige a login (nunca expone el escáner sin autenticar)", async ({ page }) => {
    await page.goto("/ie/scan");
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test("/:community/rewards sin sesión redirige a login", async ({ page }) => {
    await page.goto("/ie/rewards");
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });
});
