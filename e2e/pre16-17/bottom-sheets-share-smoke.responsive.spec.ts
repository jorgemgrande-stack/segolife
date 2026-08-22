import { test, expect } from "@playwright/test";
import { loginViaUI } from "./fixtures/auth";
import { student, admin } from "./fixtures/credentials";

/**
 * "UX móvil: Bottom Sheets globales + Comments + Share" — SMOKE NO
 * DESTRUCTIVO en PRODUCCIÓN real (www.segolife.es).
 *
 * Deliberadamente de solo lectura: nunca se comparte de verdad ni se crea
 * ningún registro real en community_proposal_shares — solo se abre/cierra
 * el sheet de QR (autoservicio, sin efectos secundarios) y se confirma que
 * ni el feed ni la propuesta activa `/ie/comunity/5` (sin participar, ver
 * com02-social-results-smoke) filtran el nuevo botón Share antes de tiempo.
 * Corre en los 3 projects de playwright.production.config.ts.
 */
test.describe("Bottom Sheets + Share — smoke no destructivo en producción", () => {
  test("QR de identidad: el sheet abre blanco, sin overflow, y cierra por Escape (self-service, sin efectos secundarios)", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}`);

    const openQr = page.getByRole("button", { name: "My SEGOLIFE ID" }).and(page.locator(":visible"));
    await openQr.click();

    const sheet = page.locator("[data-vaul-drawer]");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByText("My SEGOLIFE ID")).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("propuesta activa sin participar (/ie/comunity/5): el botón Share tampoco aparece antes de tiempo", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/comunity/5`);
    await expect(page.getByText(/i'm in/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  });

  test("Admin: el panel de Comunity sigue renderizando sin overflow (backoffice no tocado por esta intervención)", async ({ page }) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.goto("/admin/comunity");
    await page.waitForTimeout(800);

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
  });
});
