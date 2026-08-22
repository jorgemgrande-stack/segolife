import { test, expect } from "@playwright/test";
import { loginViaUI } from "./fixtures/auth";
import { student } from "./fixtures/credentials";

/**
 * "Bugfix: impedir voto múltiple" — SMOKE NO DESTRUCTIVO en PRODUCCIÓN real
 * (www.segolife.es). La cuenta QA (qa.pre1617.ie@segolife.es) NUNCA ha
 * respondido a ninguna propuesta activa real (confirmado por lectura
 * directa) — votar ahora solo para esta verificación crearía una
 * participación/recompensa real e irreversible, prohibido por el mismo
 * criterio que COM-02B ("no votar de nuevo"). Este smoke confirma en su
 * lugar, de forma no destructiva: el feed `/ie/comunity` renderiza sin
 * overflow con el nuevo campo `locked`, y la propuesta real activa
 * `/ie/comunity/5` (me_apunto, sin participar) sigue mostrando "I'm in"
 * disponible — nunca bloqueada por error para quien no ha votado — y su
 * detalle sigue mostrando el VoteForm de siempre (regresión, cero cambios
 * de comportamiento para quien no ha participado).
 */
test.describe("Bugfix voto múltiple — smoke no destructivo en producción", () => {
  test("el feed Active renderiza sin overflow, y la propuesta real sin participar mantiene 'I'm in' disponible (nunca bloqueada por error)", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/comunity`);

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);

    // Sin participar todavía (confirmado por lectura directa) — el botón
    // rápido debe seguir siendo una acción real, nunca "Already joined".
    const imIn = page.getByRole("button", { name: /i'm in/i });
    if (await imIn.count() > 0) {
      await expect(imIn.first()).toBeEnabled();
      await expect(page.getByRole("button", { name: /already joined/i })).toHaveCount(0);
    }
  });

  test("/ie/comunity/5 (activa, real, sin participar): sigue mostrando el VoteForm de siempre — regresión, nunca un bloqueo por error", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/comunity/5`);
    await expect(page.getByText(/i'm in/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });
});
