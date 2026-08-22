import { test, expect } from "@playwright/test";
import { loginViaUI } from "./fixtures/auth";
import { student, admin } from "./fixtures/credentials";

/**
 * COM-02 — SMOKE NO DESTRUCTIVO en PRODUCCIÓN real (www.segolife.es).
 *
 * Deliberadamente de solo lectura: en el momento de esta verificación,
 * producción no tiene ninguna community_proposals con status='closed'
 * (confirmado por consulta read-only), así que no existe todavía un
 * "detalle social" real que abrir — este spec confirma que (a) los
 * endpoints tRPC nuevos de COM-02 responden 200/limpio ya autenticado, y
 * (b) la UI del feed/panel admin renderiza sin overflow. No se crea, borra
 * ni modera ningún comentario/like real. Corre en los 3 projects de
 * playwright.production.config.ts (desktop/mobile/tablet).
 *
 * Nota: NO se comprueban "cero errores de consola" — este SPA hace
 * navegación dura (page.goto) tras el login, y eso aborta de forma benigna
 * (net::ERR_ABORTED) fetches genéricos ya en vuelo de la página anterior
 * (p.ej. communities.getBySlug, ajeno a COM-02) — ruido conocido de este
 * patrón de test, no un fallo de la app; verificado repitiendo el smoke y
 * confirmando que el endpoint abortado nunca es uno de COM-02.
 */
test.describe("COM-02 — smoke no destructivo en producción", () => {
  test("Student: endpoint listResultsFeed responde 200 y la UI del feed renderiza sin overflow", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);

    const apiResponse = await page.request.get("/api/trpc/community.listResultsFeed");
    expect(apiResponse.status(), await apiResponse.text().catch(() => "")).toBe(200);

    await page.goto(`/${student.community}/comunity`);
    await page.getByRole("tab", { name: /results|resultados/i }).click();
    // Sin propuestas cerradas reales todavía en producción — el estado
    // vacío es un resultado válido de este smoke (nunca se crea ninguna).
    await page.waitForTimeout(800);

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });

  test("Admin: el panel de Comunity renderiza sin overflow (sin propuestas cerradas reales todavía)", async ({ page }) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.goto("/admin/comunity");
    await page.waitForTimeout(800);

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });
});
