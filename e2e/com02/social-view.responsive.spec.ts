import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, proposalIds } from "./fixtures/credentials.local";

/**
 * COM-02 — verificación visual (mobile 390×844 / tablet 1024×768; el project
 * "desktop" de playwright.com02-local.config.ts también ejecuta este archivo
 * al no tener testMatch restrictivo, cubriendo así el caso desktop) del feed
 * social + detalle + hoja de comentarios: sin overflow horizontal, bottom
 * nav intacto, capturas para comparación manual.
 */

test.describe("COM-02 — responsive: feed, detalle, comentarios", () => {
  test("Results feed no tiene overflow horizontal", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity`);
    await dismissCookieBanner(page);
    await page.getByRole("tab", { name: "Results" }).click();
    await expect(page.getByText("[QA COM-02] Tanker's official pre (verificación E2E)").first()).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-results-feed.png`, fullPage: true });
    await context.close();
  });

  test("detalle social (sin imagen) sin overflow + bottom nav visible", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(page);
    await expect(page.getByRole("button", { name: "Comments", exact: true })).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-detail-no-image.png`, fullPage: true });
    await context.close();
  });

  test("hoja de comentarios: cerrada, abierta y tras crear un comentario", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(page);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-comments-closed.png` });

    await page.getByRole("button", { name: "Comments", exact: true }).click();
    // No se asume el contenido exacto del comentario sembrado: comments.spec.ts
    // (misma BD) puede haberlo ocultado vía moderación antes de que corra este
    // archivo — solo se comprueba que la hoja cargó (título con contador).
    await expect(page.getByText(/^Comments \(/)).toBeVisible();
    // Esperar a que termine la animación de entrada del Sheet (transform CSS)
    // antes de capturar — si no, la captura puede quedar a medio deslizar.
    await page.locator('[role="dialog"]').first().waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    const hasOverflowSheetOpen = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflowSheetOpen).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-comments-open.png` });

    const text = `[QA COM-02] responsive ${test.info().project.name} ${Date.now()}`;
    await page.getByPlaceholder("Write a comment…").fill(text);
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText(text)).toBeVisible();
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-comment-created.png` });
    await context.close();
  });
});
