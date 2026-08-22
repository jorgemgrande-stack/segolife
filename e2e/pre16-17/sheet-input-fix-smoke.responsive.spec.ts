import { test, expect } from "@playwright/test";
import { loginViaUI } from "./fixtures/auth";
import { student } from "./fixtures/credentials";

/**
 * "Bugfix: input negro e ilegible en Comments Bottom Sheet" — SMOKE NO
 * DESTRUCTIVO en PRODUCCIÓN real (www.segolife.es).
 *
 * Producción no tiene todavía ninguna community_proposals con status
 * 'closed' (confirmado por lectura directa), así que no existe un
 * Comments real que abrir sin participar antes en una propuesta —
 * comprobado exhaustivamente con BD real en local (ver
 * segolife-bottom-sheets-share.spec.ts). Este smoke verifica en su lugar,
 * de forma no destructiva, que el fix estructural de tokens
 * (.segolife-sheet-surface) está realmente desplegado: abre el sheet de
 * QR (autoservicio, sin efectos secundarios) y confirma que --primary/
 * --input dentro del sheet resuelven a la paleta violeta de Segolife, no
 * al naranja/oscuro del admin.
 */
test.describe("Bugfix input negro — smoke no destructivo en producción", () => {
  test("dentro del sheet, --primary/--input resuelven al lila de Segolife (nunca al naranja del admin)", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}`);

    await page.getByRole("button", { name: "My SEGOLIFE ID" }).and(page.locator(":visible")).click();
    const sheet = page.locator("[data-vaul-drawer]");
    await expect(sheet).toBeVisible();

    // El build de producción minifica el valor oklch() (p.ej. "52%" en vez
    // de "0.52") — se compara por el hue real (296=lila Segolife / 45=
    // naranja admin), nunca por igualdad exacta de string frente al build.
    const tokens = await sheet.evaluate(el => {
      const cs = getComputedStyle(el);
      return { primary: cs.getPropertyValue("--primary").trim(), input: cs.getPropertyValue("--input").trim() };
    });
    expect(tokens.primary).toMatch(/296\)$/);
    expect(tokens.primary).not.toMatch(/\b45\)$/);
    expect(tokens.input).toMatch(/300\)$/);
  });
});
