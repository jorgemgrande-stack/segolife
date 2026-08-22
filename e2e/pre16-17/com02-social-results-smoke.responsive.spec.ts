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

  /**
   * COM-02B — fix de producto: la ficha social ahora también aparece en una
   * propuesta ACTIVA cuando el Student YA respondió. La cuenta QA dedicada
   * (qa.pre1617.ie@segolife.es) NUNCA ha respondido a ninguna propuesta real
   * (confirmado por lectura directa) — votar ahora solo para esta
   * verificación crearía una participación/recompensa real, prohibido por
   * el punto 18/31 ("no votar de nuevo", "0 alteraciones votes"). Este smoke
   * confirma en su lugar, de forma no destructiva, que la propuesta real
   * /ie/comunity/5 (activa, la que motivó este fix) sigue mostrando el
   * VoteForm de siempre para quien no ha participado — regresión, nunca se
   * envía ningún voto — y que la capa social NO aparece antes de participar.
   */
  test("COM-02B (no destructivo): /ie/comunity/5 activa y sin participar sigue mostrando VoteForm, nunca la capa social", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/comunity/5`);
    await expect(page.getByText(/i'm in/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Comments", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Like", exact: true })).toHaveCount(0);

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });
});
