import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * FIX-03 — Rewards ?tab=benefits deep-link, contra producción real
 * (playwright.production.config.ts, mismo criterio que el resto de la
 * suite pre16-17). Bug real: `?tab=benefits` nunca se comprobaba en el
 * cálculo de la pestaña inicial (solo `tab=invite` tenía su rama), y
 * <Tabs> era no controlado — un cambio de query sin remount no
 * actualizaba la pestaña visible. Ambos casos son navegación pura, sin
 * mutación económica — seguro de ejecutar contra producción real.
 */
async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

test.describe("FIX-03 — Rewards: deep-link ?tab=benefits abre Mis Beneficios directamente", () => {
  test("/ie/rewards?tab=benefits abre la pestaña Beneficios ya seleccionada al cargar", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/ie/rewards?tab=benefits");
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const benefitsTab = page.getByRole("tab", { name: /my benefits|mis beneficios/i });
    await expect(benefitsTab).toHaveAttribute("aria-selected", "true", { timeout: 15000 });
  });

  test("/ie/benefits (alias por path, Fase 4) sigue abriendo Beneficios directamente — sin regresión", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/ie/benefits");
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const benefitsTab = page.getByRole("tab", { name: /my benefits|mis beneficios/i });
    await expect(benefitsTab).toHaveAttribute("aria-selected", "true", { timeout: 15000 });
  });

  test("/ie/rewards (sin query) abre Spend por defecto, y clicar Beneficios lo activa — Tabs controlado, no atascado", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/ie/rewards");
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const spendTab = page.getByRole("tab", { name: /spend segotokens|gastar segotokens/i });
    await expect(spendTab).toHaveAttribute("aria-selected", "true", { timeout: 15000 });

    const benefitsTab = page.getByRole("tab", { name: /my benefits|mis beneficios/i });
    await benefitsTab.click();
    await expect(benefitsTab).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=benefits/);
  });
});
