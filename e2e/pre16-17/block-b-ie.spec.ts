import { test, expect } from "@playwright/test";
import { allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

test.describe("BLOCK B — IE, ítems pendientes", () => {
  test("B09 — login preserva returnTo=/ie tras autenticarse", async ({ page }) => {
    const [venue] = allVenueAccounts();
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword(), "/ie");
    expect(page.url()).toContain("/ie");
    expect(page.url()).not.toContain("/admin");
  });

  test("B14 — responsive: /ie no tiene overflow horizontal en móvil", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ie");
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(hasOverflow).toBe(false);
    await expect(page.getByRole("link", { name: /join|únete/i }).first()).toBeVisible();
  });
});

test.describe("Regresión rápida A/B (no repite todo, solo confirma que sigue en pie)", () => {
  test("A — footer de Home tiene los 4 enlaces legales", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").scrollIntoViewIfNeeded().catch(() => {});
    await expect(page.getByRole("link", { name: "Términos y condiciones" })).toHaveAttribute("href", "/terminos");
    await expect(page.getByRole("link", { name: "Política de privacidad" })).toHaveAttribute("href", "/privacidad");
    await expect(page.getByRole("link", { name: "Política de cookies" })).toHaveAttribute("href", "/cookies");
    await expect(page.getByRole("link", { name: "Condiciones de cancelación" })).toHaveAttribute("href", "/condiciones-cancelacion");
  });

  test("B — /ie header CTA preserva comunidad en el registro", async ({ page }) => {
    await page.goto("/ie");
    const joinLinks = page.getByRole("link", { name: /join segolife/i });
    const href = await joinLinks.first().getAttribute("href");
    expect(href).toBe("/register?community=ie");
  });
});
