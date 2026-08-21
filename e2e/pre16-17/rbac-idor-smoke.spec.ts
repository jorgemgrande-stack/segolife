import { test, expect } from "@playwright/test";
import { admin, student, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * SUPERPROMPT FINAL REMAINING ACTIONS — smoke RBAC/IDOR contra producción
 * real. NO reabre STU-01/STU-02/LNF-01 (cada uno ya tiene su propia
 * cobertura dedicada de RBAC/IDOR — ver sus propios specs/tests). Esto es
 * solo una confirmación en vivo de los 3 perfiles reales tras el último
 * despliegue, sin mutaciones.
 */
test.describe("RBAC/IDOR smoke — perfiles reales", () => {
  test("Student: nunca ve contenido real de /admin (pantalla 'Sin permisos', nunca la tabla)", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await page.goto("/admin/students");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/sin permisos/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder(/buscar por nombre o email/i)).toHaveCount(0);
  });

  test("venue_admin (Casanova): aterriza en la Venue App, nunca ve el sidebar global ni /admin/lost-found", async ({ page }) => {
    await loginViaUI(page, "casanova@segolife.es", venuePassword());
    await page.waitForLoadState("domcontentloaded");
    await page.waitForURL(/\/admin\/mi-local/, { timeout: 15000 });
    // Sin sidebar de Global Admin — "Objetos perdidos" (nav global) no debe existir aquí.
    await expect(page.getByRole("link", { name: /^objetos perdidos$/i })).toHaveCount(0);

    await page.goto("/admin/lost-found");
    await page.waitForLoadState("domcontentloaded");
    // FORBIDDEN esperado: nunca la tabla de listado global.
    await expect(page.getByRole("heading", { name: /^objetos perdidos$/i })).toHaveCount(0);
  });

  test("Global Admin: conserva acceso completo (Students, Lost & Found, Integrations)", async ({ page }) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");

    await page.goto("/admin/students");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByPlaceholder(/buscar por nombre o email/i)).toBeVisible({ timeout: 10000 });

    await page.goto("/admin/lost-found");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /objetos perdidos/i })).toBeVisible({ timeout: 10000 });

    await page.goto("/admin/integrations");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/casanova/i).first()).toBeVisible({ timeout: 10000 });
  });
});
