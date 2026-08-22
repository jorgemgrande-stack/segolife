import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, proposalIds } from "./fixtures/credentials-sheets.local";

/**
 * "UX móvil: Bottom Sheets globales + Comments + Share" — verificación
 * visual (mobile 390×844 / tablet 1024×768; desktop vía
 * segolife-bottom-sheets-share.spec.ts). Sin overflow horizontal, esquinas
 * superiores redondeadas, blanco real, bottom nav intacto detrás del sheet.
 */
async function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test.describe("Responsive — QR de identidad", () => {
  test("sheet blanco, sin overflow, esquinas redondeadas", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}`);
    await dismissCookieBanner(page);

    await page.getByRole("button", { name: "My SEGOLIFE ID" }).and(page.locator(":visible")).click();
    const sheet = page.locator("[data-vaul-drawer]");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(sheet).toHaveCSS("border-top-left-radius", /[1-9]/);

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-sheets-qr.png` });
    await context.close();
  });
});

test.describe("Responsive — Comments", () => {
  test("sheet blanco, composer visible, sin overflow", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.closedVoted}`);
    await dismissCookieBanner(page);

    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const sheet = page.locator("[data-vaul-drawer]");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByPlaceholder("Write a comment…")).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-sheets-comments.png` });
    await context.close();
  });
});

test.describe("Responsive — Share fallback", () => {
  test("sheet blanco con las 4 opciones reales, sin overflow, bottom nav sigue accesible detrás", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.closedVoted}`);
    await dismissCookieBanner(page);

    await page.getByRole("button", { name: "Share", exact: true }).click();
    const sheet = page.locator("[data-vaul-drawer]");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(sheet.getByText("Copy link")).toBeVisible();
    await expect(sheet.getByText("WhatsApp")).toBeVisible();
    await expect(sheet.getByText("Telegram")).toBeVisible();
    await expect(sheet.getByText("Email")).toBeVisible();

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `artifacts/com02-local/${test.info().project.name}-sheets-share.png` });
    await context.close();
  });
});
