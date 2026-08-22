import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, ieB, uvaA, proposalIds } from "./fixtures/credentials-com02b.local";

/**
 * COM-02B — E2E LOCAL (BD real): la ficha social debe aparecer tras
 * PARTICIPAR en una propuesta activa, no solo al cerrarse (fix de producto
 * sobre COM-02). Cubre: activa+sin responder (VoteForm, comentarios/like
 * denegados server-side), activa+ya respondió (ficha social, "Voting open",
 * comentarios/like permitidos), transición inmediata voto→social sin
 * recarga, cerrada (regresión: "Voting finished" + resultado final),
 * scoping cruzado IE/UVA sobre una propuesta activa.
 */

test.describe("COM-02B — activa + SIN responder: sigue siendo VoteForm, sin capa social", () => {
  test("VoteForm visible, sin Comments/Like, y el backend deniega crear comentario/dar like directamente", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieB.email, ieB.password) });
    const page = await context.newPage();
    await page.goto(`/${ieB.community}/comunity/${proposalIds.singleChoiceActiveUnvoted}`);
    await dismissCookieBanner(page);

    await expect(page.getByText("Emprendimiento")).toBeVisible();
    await expect(page.getByRole("button", { name: "Comments", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Like", exact: true })).toHaveCount(0);

    // Server-side real (spec COM-02B §8/§9): incluso llamando directo al endpoint, sin pasar por la UI.
    // Formato batch real de httpBatchLink (client/src/main.tsx) — "0":{"json":...}.
    const commentAttempt = await page.request.post("/api/trpc/community.createComment?batch=1", {
      data: { "0": { json: { proposalId: proposalIds.singleChoiceActiveUnvoted, content: "[QA COM-02B] intento antes de votar" } } },
    });
    expect(commentAttempt.status()).toBe(400); // TRPCError BAD_REQUEST (CommunitySocialError NOT_CLOSED mapeado)
    const likeAttempt = await page.request.post("/api/trpc/community.toggleLike?batch=1", {
      data: { "0": { json: { proposalId: proposalIds.singleChoiceActiveUnvoted } } },
    });
    expect(likeAttempt.status()).toBe(400);
    await context.close();
  });
});

test.describe("COM-02B — activa + YA respondió: ficha social inmediata (fix de producto)", () => {
  test("muestra ficha social con 'Voting open', 'You already participated', y permite comentar/dar like", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApuntoActiveVoted}`);
    await dismissCookieBanner(page);

    await expect(page.getByRole("button", { name: "Comments", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Like", exact: true })).toBeVisible();
    await expect(page.getByText("Voting open")).toBeVisible();
    await expect(page.getByText("You already participated")).toBeVisible();
    await expect(page.getByText("Voting finished")).toHaveCount(0);

    // Comentar durante una propuesta ACTIVA (ya respondida) — requisito central del fix.
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const text = `[QA COM-02B] comentario en propuesta activa ya votada ${Date.now()}`;
    await page.getByPlaceholder("Write a comment…").fill(text);
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText(text)).toBeVisible();

    await context.close();
  });
});

test.describe("COM-02B — transición inmediata voto → ficha social (spec §11, sin recargar)", () => {
  test("votar Sí transiciona automáticamente a la ficha social, con 'Your response: Yes'", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.yesNoActiveForVoting}`);
    await dismissCookieBanner(page);

    // Antes de votar: VoteForm real (Sí/No), sin ficha social todavía.
    await expect(page.getByRole("button", { name: "Comments", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "👍 Yes" }).click();
    await page.getByRole("button", { name: "Vote" }).click();

    // Después: SIN recargar la página, debe transicionar a la ficha social.
    await expect(page.getByRole("button", { name: "Comments", exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Your response:.*Yes/)).toBeVisible();
    await context.close();
  });
});

test.describe("COM-02B — cerrada: regresión, sigue mostrando 'Voting finished' + resultado final", () => {
  test("propuesta cerrada muestra el estado final, no 'Voting open'", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.yesNoClosed}`);
    await dismissCookieBanner(page);
    await expect(page.getByText("Voting finished")).toBeVisible();
    await expect(page.getByText("Voting open")).toHaveCount(0);
    await context.close();
  });
});

test.describe("COM-02B — scoping cruzado IE/UVA también se aplica a propuestas ACTIVAS ya respondidas", () => {
  test("un estudiante de UVA no puede comentar una propuesta IE activa, aunque tenga participación en su propia comunidad", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, uvaA.email, uvaA.password) });
    const page = await context.newPage();
    const attempt = await page.request.post("/api/trpc/community.createComment?batch=1", {
      data: { "0": { json: { proposalId: proposalIds.meApuntoActiveVoted, content: "[QA COM-02B] cross-community" } } },
    });
    expect(attempt.status()).toBe(403);
    await context.close();
  });
});
