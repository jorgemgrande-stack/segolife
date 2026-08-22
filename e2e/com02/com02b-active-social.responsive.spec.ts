import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, proposalIds } from "./fixtures/credentials-com02b.local";

/**
 * COM-02B — verificación visual (mobile 390×844 / tablet 1024×768; desktop
 * vía com02b-active-social.spec.ts) de los elementos NUEVOS de esta fase:
 * la insignia "Voting open" + tiempo restante y "You already participated"
 * sobre una propuesta ACTIVA ya respondida — sin overflow, sin romper el
 * layout ya verificado en COM-02.
 */
test.describe("COM-02B — responsive: ficha social de propuesta activa ya respondida", () => {
  test("sin overflow horizontal en ningún viewport", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApuntoActiveVoted}`);
    await dismissCookieBanner(page);
    await expect(page.getByText("Voting open")).toBeVisible();
    await expect(page.getByText("You already participated")).toBeVisible();

    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasOverflow).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-com02b-active-voted.png`, fullPage: true });
    await context.close();
  });
});
