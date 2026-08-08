import { test, expect } from "@playwright/test";

/**
 * Fase 6 — Explore (público, sin sesión) y navegación a Event Detail.
 * Flujo A del spec: visit /ie → explore → event. No hace falta login (Explore
 * y Event Detail son públicos). No depende de que existan eventos reales —
 * si la BD está vacía, confirma el empty state en vez de fallar.
 */
test.describe("Segolife — Explore y detalle de evento", () => {
  test("Explore carga sin sesión con las pestañas Eventos/Locales", async ({ page }) => {
    await page.goto("/ie/explore");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("tab", { name: /events|eventos/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("tab", { name: /venues|locales/i })).toBeVisible({ timeout: 8000 });
  });

  test("pestaña Eventos: muestra tarjetas reales o el empty state, nunca contenido inventado", async ({ page }) => {
    await page.goto("/ie/explore");
    const eventLinks = page.locator('a[href*="/ie/events/"]');
    const emptyState = page.getByText(/no events found|no se han encontrado eventos/i);
    await expect(eventLinks.first().or(emptyState)).toBeVisible({ timeout: 8000 });
  });

  test("clicar una tarjeta de evento navega a su Event Detail con la info real", async ({ page }) => {
    await page.goto("/ie/explore");
    const firstEvent = page.locator('a[href*="/ie/events/"]').first();
    if (await firstEvent.count() === 0) {
      test.skip(true, "Sin eventos reales publicados para IE en este entorno — nada que navegar (no se simula contenido).");
    }
    await firstEvent.click();
    await expect(page).toHaveURL(/\/ie\/events\//, { timeout: 8000 });
    await expect(page.locator("h1")).toBeVisible({ timeout: 8000 });
    // "Tickets coming soon" — placeholder honesto, nunca un flujo de compra real (Fourvenues es fase futura).
    await expect(page.getByText(/tickets coming soon|entradas pr[oó]ximamente/i)).toBeVisible();
  });

  test("pestaña Locales: muestra tarjetas reales o el empty state, y el aviso de mapa no disponible", async ({ page }) => {
    await page.goto("/ie/explore");
    await page.getByRole("tab", { name: /venues|locales/i }).click();
    const venueLinks = page.locator('a[href*="/ie/venues/"]');
    const emptyState = page.getByText(/no venues found|no se han encontrado locales/i);
    await expect(venueLinks.first().or(emptyState)).toBeVisible({ timeout: 8000 });
  });
});
