import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, proposalIds } from "./fixtures/credentials-sheets.local";

/**
 * "UX móvil: Bottom Sheets globales + Comments + Share" — E2E LOCAL (BD real).
 * Cubre los tests obligatorios del spec (§16): Bottom Sheet genérico (vía QR
 * y Comments, que ya lo usan en producción), QR migrado, Comments migrado
 * (regresión funcional), y Share (visible, fallback funcional, registro
 * persistente, contador). navigator.share NO existe en el Chromium headless
 * de Playwright (confirmado empíricamente: `typeof navigator.share ===
 * "undefined"`), así que el botón Share en este entorno siempre abre
 * `ShareFallbackSheet` — nunca el diálogo nativo del SO.
 */

test.describe("Bottom Sheet — QR de identidad (SegolifeIdentityQrButton)", () => {
  test("abre desde el header, blanco, QR real, cierra con X / Escape / backdrop, 'Regenerate' sigue funcionando", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}`);
    await dismissCookieBanner(page);

    // SegolifeAppShell monta el botón QR dos veces en el DOM a la vez (header
    // mobile `xl:hidden` + SegolifeDesktopTopBar `xl:flex`) — solo uno es
    // visible según el viewport. Este spec corre únicamente bajo el proyecto
    // "desktop" (1440x900, no coincide con `.responsive.spec.ts`), así que
    // `.and(:visible)` resuelve siempre al de SegolifeDesktopTopBar.
    const openQr = page.getByRole("button", { name: "My SEGOLIFE ID" }).and(page.locator(":visible"));
    await openQr.click();

    const sheet = page.locator('[data-vaul-drawer]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByText("My SEGOLIFE ID")).toBeVisible();
    await expect(sheet.locator("svg").first()).toBeVisible();

    // Cierre por X explícita.
    await page.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();

    // Reabrir + cierre por Escape.
    await openQr.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Reabrir + cierre por backdrop.
    await openQr.click();
    await expect(sheet).toBeVisible();
    await page.locator("[data-vaul-overlay]").click({ position: { x: 5, y: 5 } });
    await expect(sheet).toBeHidden();

    // Reabrir + "Regenerate code" real sigue funcionando (rota el token real).
    await openQr.click();
    await expect(sheet).toBeVisible();
    await page.getByRole("button", { name: /regenerate/i }).click();
    await expect(page.getByText(/regenerated|regenerad/i)).toBeVisible();
    await context.close();
  });
});

test.describe("Bottom Sheet — Comments (regresión funcional tras la migración)", () => {
  test("abre, carga comentarios, crea un comentario nuevo, y cierra correctamente", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.closedVoted}`);
    await dismissCookieBanner(page);

    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const sheet = page.locator('[data-vaul-drawer]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(sheet.getByRole("heading", { name: /^Comments/ })).toBeVisible();

    // Bugfix "input negro e ilegible en Comments Bottom Sheet" (2026-08-22):
    // el composer debe ser blanco de verdad, con texto/caret oscuros y un
    // focus ring lila Segolife — nunca heredar el naranja/negro del tema
    // admin (ver .segolife-sheet-input/.segolife-sheet-surface en index.css).
    const composer = page.getByPlaceholder("Write a comment…");
    await expect(composer).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const body = `[QA SHEETS] comentario ${Date.now()}`;
    await composer.fill(body);
    await expect(composer).toHaveCSS("color", "oklch(0.2 0.02 300)");
    await composer.focus();
    await expect(composer).toHaveCSS("border-color", "oklch(0.52 0.19 296)");
    const postButton = page.getByRole("button", { name: "Post" });
    await expect(postButton).toHaveCSS("background-color", "oklch(0.52 0.19 296)");

    await postButton.click();
    await expect(sheet.getByText(body)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await context.close();
  });
});

test.describe("Share — acción visible, fallback funcional, registro persistente, contador", () => {
  test("Share abre el fallback (sin navigator.share en Chromium headless), Copy link funciona, el contador se actualiza y persiste tras recargar", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: await storageStateFor(browser, ieA.email, ieA.password),
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.closedVoted}`);
    await dismissCookieBanner(page);

    expect(await page.evaluate(() => typeof (navigator as any).share)).toBe("undefined");

    const shareButton = page.getByRole("button", { name: "Share", exact: true });
    await expect(shareButton).toBeVisible();
    // El contador es persistente (spec §7) y este spec puede correr varias
    // veces contra la misma proposal local antes del cleanup — comparar
    // relativo al valor real de partida, nunca asumir que empieza en 0.
    const countBefore = Number((await shareButton.textContent())?.trim() || "0");

    await shareButton.click();
    const sheet = page.locator('[data-vaul-drawer]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Share post")).toBeVisible();
    await expect(sheet.getByText("Copy link")).toBeVisible();
    await expect(sheet.getByText("WhatsApp")).toBeVisible();
    await expect(sheet.getByText("Telegram")).toBeVisible();
    await expect(sheet.getByText("Email")).toBeVisible();

    await sheet.getByText("Copy link").click();
    await expect(page.getByText("Link copied")).toBeVisible();
    await expect(sheet).toBeHidden();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(`http://localhost:3000/${ieA.community}/comunity/${proposalIds.closedVoted}`);

    // El contador debe reflejar el nuevo share tanto de forma optimista como
    // tras recargar (spec §7: la fuente de verdad es la tabla persistente
    // community_proposal_shares, no solo el caché de React Query en memoria).
    await expect(shareButton).toContainText(String(countBefore + 1));
    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByRole("button", { name: "Share", exact: true })).toContainText(String(countBefore + 1));
    await context.close();
  });
});
