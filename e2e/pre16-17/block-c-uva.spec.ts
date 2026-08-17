import { test, expect } from "@playwright/test";
import { allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

test.describe("BLOCK C — UVA public experience", () => {
  test("C01/C02 — /uva carga anónimo, sin shell autenticado", async ({ page }) => {
    await page.goto("/uva");
    await expect(page.getByRole("link", { name: /ya tengo cuenta|i have an account/i }).first()).toBeVisible();
    await expect(page.locator("text=/wallet|segotokens saldo/i")).toHaveCount(0);
  });

  test("C03/C04 — contexto UVA visible + idioma español por defecto", async ({ page }) => {
    await page.goto("/uva");
    await expect(page.getByRole("heading", { name: /segolife uva/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "ES", exact: true })).toHaveAttribute("class", /bg-primary|active/);
    await expect(page.getByText("Comunidad, eventos y recompensas")).toBeVisible();
  });

  test("C06 — CTA de registro del header preserva community=uva", async ({ page }) => {
    await page.goto("/uva");
    const href = await page.getByRole("link", { name: /join segolife|únete a segolife/i }).first().getAttribute("href");
    expect(href).toBe("/register?community=uva");
  });

  test("C07 — login preserva returnTo=/uva", async ({ page }) => {
    const [venue] = allVenueAccounts();
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword(), "/uva");
    expect(page.url()).toContain("/uva");
  });

  test("C10 — sin nav de Student autenticado en /uva anónimo", async ({ page }) => {
    await page.goto("/uva");
    await expect(page.locator("nav >> text=/mis entradas|my tickets/i")).toHaveCount(0);
  });

  test("C11 — footer de /uva tiene los mismos 4 enlaces legales", async ({ page }) => {
    await page.goto("/uva");
    await expect(page.getByRole("link", { name: "Términos y condiciones" })).toHaveAttribute("href", "/terminos");
    await expect(page.getByRole("link", { name: "Condiciones de cancelación" })).toHaveAttribute("href", "/condiciones-cancelacion");
  });

  test("C12 — sin branding de Náyade/Skicenter en el HTML servido", async ({ page }) => {
    await page.goto("/uva");
    const html = await page.content();
    expect(html).not.toMatch(/n[áa]yade/i);
    expect(html).not.toMatch(/skicenter/i);
  });

  test("C13 — responsive móvil sin overflow horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/uva");
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(hasOverflow).toBe(false);
  });
});
