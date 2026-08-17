import { test, expect } from "@playwright/test";
import { student, allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * BLOCK T — matriz responsive. Este archivo corre en los 3 projects
 * (desktop 1440×900, mobile 390×844, tablet 1024×768 — ver
 * playwright.production.config.ts, testMatch scoped a *.responsive.spec.ts).
 * Un solo criterio objetivo por superficie: overflow horizontal — no
 * reescribimos diseño por preferencia estética, solo defectos objetivos.
 */
async function noHorizontalOverflow(page: import("@playwright/test").Page, label: string) {
  await page.waitForLoadState("networkidle");
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(hasOverflow, `overflow horizontal en ${label}`).toBe(false);
}

const [venue] = allVenueAccounts();
const EVENT_SLUG = "pre-opening-x-fcking-wednesdays";

test.describe("BLOCK T — superficies públicas", () => {
  for (const path of ["/", "/ie", "/uva", "/login", "/register", "/terminos", "/privacidad"]) {
    test(`sin overflow en ${path}`, async ({ page }) => {
      await page.goto(path);
      await noHorizontalOverflow(page, path);
    });
  }
});

test.describe("BLOCK T — Student autenticado", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
  });

  for (const path of [
    `/ie`, `/ie/explore`, `/ie/profile`, `/ie/rewards`, `/ie/notifications`, `/ie/events/${EVENT_SLUG}`,
  ]) {
    test(`sin overflow en ${path} (Student)`, async ({ page }) => {
      await page.goto(path);
      await noHorizontalOverflow(page, path);
    });
  }
});

test.describe("BLOCK T — Venue App", () => {
  test("sin overflow en /admin/mi-local (Venue, todas las pestañas visibles)", async ({ page }) => {
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword());
    await page.goto("/admin/mi-local");
    await page.waitForLoadState("networkidle");
    const acceptCookies = page.getByRole("button", { name: /accept all|aceptar todas/i });
    if (await acceptCookies.isVisible({ timeout: 3000 }).catch(() => false)) await acceptCookies.click();
    await noHorizontalOverflow(page, "/admin/mi-local (Hoy)");
    for (const tab of ["TPV", "Entradas", "Caja"]) {
      await page.getByRole("navigation").getByRole("button", { name: tab }).click();
      await noHorizontalOverflow(page, `/admin/mi-local (${tab})`);
    }
  });
});
