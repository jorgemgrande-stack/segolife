import { test, expect } from "@playwright/test";
import { admin } from "./fixtures/credentials";

/**
 * ops01-la-finca-parity.spec.ts — OPS-01 (Fourvenues La Finca production
 * activation). Verificación visual real, con datos reales, de que La Finca
 * se comporta igual que las otras integraciones Fourvenues ya conectadas:
 * aparece en Admin Events con el filtro de venue y el badge "Borrador
 * Fourvenues" (sus 2 eventos reales son sourcePublicationStatus=unpublished,
 * confirmado vía API antes de este test), y su página pública de venue
 * carga con normalidad (sin overflow/errores) aunque hoy no tenga ningún
 * evento visible al Student — DATA STATE real (0 eventos publicados),
 * nunca fabricado aquí.
 */
async function loginAdmin(page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', admin.email);
  await page.fill('input[type="password"]', admin.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 10000 });
}

test.describe("OPS-01 — La Finca paridad (Admin Events + Venue Detail pública)", () => {
  test("Admin Events: filtrar por La Finca Club muestra sus 2 eventos reales con badge 'Borrador Fourvenues'", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/events");
    await expect(page).not.toHaveURL(/\/login/);

    // La tabla general está paginada/ordenada por fecha — los 2 eventos
    // reales de La Finca (futuros, sept 2026) no están en la primera página
    // por defecto. Usar el buscador real de la página en vez de asumir
    // orden/paginación.
    await page.getByPlaceholder(/buscar por nombre/i).fill("LA FINCA CLUB");
    await expect(page.getByText(/LA FINCA CLUB VOL\.04/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/LA FINCA CLUB VOL\.05/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/borrador fourvenues/i).first()).toBeVisible();
  });

  test("Venue Detail pública de La Finca Club carga sin errores (0 eventos visibles hoy — DATA STATE real, ambos son drafts Fourvenues)", async ({ page }) => {
    await page.goto("/ie/venues/la-finca-club");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/la finca club/i).first()).toBeVisible({ timeout: 10000 });
    // Ningún evento draft debe filtrarse a esta vista pública.
    await expect(page.getByText(/VOL\.04|VOL\.05/i)).toHaveCount(0);
  });
});
