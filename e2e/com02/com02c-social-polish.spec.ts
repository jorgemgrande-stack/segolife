import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, proposalIds } from "./fixtures/credentials-com02c.local";

/**
 * COM-02C — E2E LOCAL (BD real): pulido visual de la ficha social. No
 * vuelve a probar la mecánica funcional ya cubierta por COM-02/COM-02B
 * (scoping, transición de voto, moderación, cross-community) — solo la
 * NUEVA presentación: sin card "Results (N)", participantes compactos
 * ("... joined"), último comentario VISIBLE en la ficha (nunca uno oculto),
 * pluralización correcta de "View comment"/"View all N comments",
 * descripción expandible, y que crear un comentario actualiza el preview
 * sin recargar.
 */

test.describe("COM-02C — activa + ya votada: layout compacto, sin fuga de resultados", () => {
  test("muestra 'Voting open' + 'Your response: Yes', nunca una card 'Results ('", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.yesNoActiveVoted}`);
    await dismissCookieBanner(page);

    await expect(page.getByText("Voting open")).toBeVisible();
    await expect(page.getByText(/Your response:.*Yes/)).toBeVisible();
    await expect(page.getByText(/^Results \(/)).toHaveCount(0);
    await context.close();
  });
});

test.describe("COM-02C — cerrada: participantes compactos + último comentario visible + descripción expandible", () => {
  test("avatar-stack dice '... joined', el comentario oculto nunca aparece como preview, y la descripción se expande", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApuntoClosed}`);
    await dismissCookieBanner(page);

    await expect(page.getByText(/^Results \(/)).toHaveCount(0);
    await expect(page.getByText(/joined/i)).toBeVisible();

    // Último comentario VISIBLE (el más antiguo, no el oculto/moderado más reciente).
    await expect(page.getByText("Comentario visible más antiguo", { exact: false })).toBeVisible();
    await expect(page.getByText(/comentario oculto/i)).toHaveCount(0);

    // Descripción larga: recortada con "… more", se expande al pulsar.
    const moreButton = page.getByText("… more");
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.getByText("… more")).toHaveCount(0);
    await expect(page.getByText(/saltos de línea/)).toBeVisible();
    await context.close();
  });
});

test.describe("COM-02C — crear comentario actualiza el preview y la pluralización, sin recargar", () => {
  test("0 comentarios -> 'Be the first' -> tras crear uno: preview + 'View comment' -> tras un segundo: 'View all 2 comments'", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.yesNoClosedNoComments}`);
    await dismissCookieBanner(page);

    await expect(page.getByText("Be the first to comment")).toBeVisible();

    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const first = `[QA COM-02C] primer comentario ${Date.now()}`;
    await page.getByPlaceholder("Write a comment…").fill(first);
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText(first).first()).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click().catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});

    // El preview de la ficha (fuera de la hoja) debe reflejar el nuevo comentario y "View comment" en singular.
    await expect(page.getByText(first).first()).toBeVisible();
    await expect(page.getByText("View comment")).toBeVisible();

    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const second = `[QA COM-02C] segundo comentario ${Date.now()}`;
    await page.getByPlaceholder("Write a comment…").fill(second);
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText(second).first()).toBeVisible();
    await page.keyboard.press("Escape").catch(() => {});

    // El preview debe pasar a ser el comentario RECIÉN creado (el más nuevo), y el contador a "View all 2 comments".
    await expect(page.getByText(second).first()).toBeVisible();
    await expect(page.getByText("View all 2 comments")).toBeVisible();
    await context.close();
  });

  test("like/unlike sigue funcionando y nunca altera 'Your response'", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.yesNoClosedNoComments}`);
    await dismissCookieBanner(page);

    const likeButton = page.getByRole("button", { name: "Like", exact: true });
    await expect(likeButton).toHaveAttribute("aria-pressed", "false");
    await likeButton.click();
    await expect(likeButton).toHaveAttribute("aria-pressed", "true");
    await likeButton.click();
    await expect(likeButton).toHaveAttribute("aria-pressed", "false");
    await context.close();
  });
});
