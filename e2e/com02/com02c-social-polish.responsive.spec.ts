import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, proposalIds } from "./fixtures/credentials-com02c.local";

/**
 * COM-02C — verificación visual (mobile 390×844 / tablet 1024×768; desktop
 * vía com02c-social-polish.spec.ts) del pulido social: sin overflow,
 * participantes compactos, último comentario integrado, descripción
 * expandible, botones táctiles cómodos.
 */
test.describe("COM-02C — responsive: ficha social pulida (cerrada, con participantes y comentario)", () => {
  test("sin overflow horizontal, participantes/comentario visibles en cualquier viewport", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApuntoClosed}`);
    await dismissCookieBanner(page);

    await expect(page.getByText(/joined/i)).toBeVisible();
    await expect(page.getByText("Comentario visible más antiguo", { exact: false })).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-com02c-closed-polished.png`, fullPage: true });
    await context.close();
  });

  test("propuesta activa ya votada: sin overflow, layout compacto", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.yesNoActiveVoted}`);
    await dismissCookieBanner(page);
    await expect(page.getByText("Voting open")).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-com02c-active-voted-polished.png`, fullPage: true });
    await context.close();
  });
});
