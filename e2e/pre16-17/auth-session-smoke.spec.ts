import { test, expect } from "@playwright/test";
import { admin, student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * SUPERPROMPT FINAL REMAINING ACTIONS — smoke de auth/sesión contra el
 * dominio canónico (www.segolife.es). NO reabre SEC-01/SEC-02 — solo
 * confirma que login/navegación/reload no regresionan tras LNF-01, tanto
 * para Student como para Admin. Ninguna mutación de datos.
 */
test.describe("Auth/session smoke — dominio canónico", () => {
  test("Student: login, navega entre páginas, recarga — sesión se mantiene todo el tiempo", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/login");

    await page.goto(`/${student.community}/explore`);
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/login");

    await page.goto(`/${student.community}/profile`);
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/login");
    await expect(page.getByText("QA PRE1617")).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/login");
    await expect(page.getByText("QA PRE1617")).toBeVisible({ timeout: 10000 });
  });

  test("Admin: login, navega entre secciones, recarga — sesión se mantiene todo el tiempo", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/login");

    await page.goto("/admin/students");
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/login");

    await page.goto("/admin/lost-found");
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/login");

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/login");
    await expect(page.getByRole("heading", { name: /objetos perdidos/i })).toBeVisible({ timeout: 10000 });
  });
});
