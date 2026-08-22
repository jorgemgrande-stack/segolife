import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, ieB, uvaA, admin, proposalIds } from "./fixtures/credentials.local";

/**
 * COM-02 — E2E LOCAL (BD real Docker) del feed social + comentarios.
 * Cubre: feed de Resultados, detalle social, crear comentario, reply anidado,
 * borrado propio, borrado ajeno RECHAZADO, moderación Admin, scoping
 * cruzado IE/UVA. Datos QA marcados "[QA COM-02]" — nunca contamina
 * producción (esta config apunta a localhost:3000). Cada cuenta se
 * autentica UNA sola vez (storageState) para no disparar el rate limiter
 * real de login (5 req/min/IP) al correr muchos tests.
 */

test.describe("COM-02 — feed de resultados", () => {
  test("Student ve el feed de Resultados con las propuestas QA cerradas", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity`);
    await dismissCookieBanner(page);
    await page.getByRole("tab", { name: "Results" }).click();
    await expect(page.getByText("[QA COM-02] Tanker's official pre (verificación E2E)").first()).toBeVisible();
    await expect(page.getByText("[QA COM-02] ¿Asistirás a la charla de orientación?").first()).toBeVisible();
    await context.close();
  });

  test("abrir una propuesta finalizada muestra el diseño social (headline, acciones, resultados)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(page);
    await expect(page.getByRole("button", { name: "Comments", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Like", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    // headline generado desde el resultado real (me_apunto → "N attended")
    await expect(page.getByText(/attended/i)).toBeVisible();
    await context.close();
  });
});

test.describe("COM-02 — comentarios: crear, reply, borrar propio, borrar ajeno rechazado", () => {
  test("flujo completo entre dos estudiantes reales de la misma comunidad", async ({ browser }) => {
    const ctxA = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const pageA = await ctxA.newPage();
    await pageA.goto(`/${ieA.community}/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(pageA);

    // Abrir comentarios y ver el comentario sembrado de FILLER1
    await pageA.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(pageA.getByText("[QA COM-02] comentario sembrado para el test de moderación admin")).toBeVisible();

    // Crear un comentario nuevo
    const commentText = `[QA COM-02] comentario de IE_A ${Date.now()}`;
    await pageA.getByPlaceholder("Write a comment…").fill(commentText);
    await pageA.getByRole("button", { name: "Post" }).click();
    await expect(pageA.getByText(commentText)).toBeVisible();

    // Segundo estudiante (misma comunidad) responde
    const ctxB = await browser.newContext({ storageState: await storageStateFor(browser, ieB.email, ieB.password) });
    const pageB = await ctxB.newPage();
    await pageB.goto(`/${ieB.community}/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(pageB);
    await pageB.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(pageB.getByText(commentText)).toBeVisible();

    const rootRowForB = pageB.locator('[data-testid^="comment-row-"]').filter({ hasText: commentText });
    await rootRowForB.getByRole("button", { name: "Reply" }).click();
    const replyText = `[QA COM-02] reply de IE_B ${Date.now()}`;
    await pageB.getByPlaceholder("Write a comment…").fill(replyText);
    await pageB.getByRole("button", { name: "Post" }).click();
    await expect(pageB.getByText(replyText)).toBeVisible();

    // IE_B NO puede borrar el comentario de IE_A: no hay botón "Delete" asociado a ese comentario
    await expect(rootRowForB.getByRole("button", { name: "Delete" })).toHaveCount(0);

    // IE_A recarga, ve la reply, y SÍ puede borrar su propio comentario (con confirmación)
    await pageA.reload();
    await dismissCookieBanner(pageA);
    await pageA.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(pageA.getByText(replyText)).toBeVisible();
    const ownRowForA = pageA.locator('[data-testid^="comment-row-"]').filter({ hasText: commentText });
    await ownRowForA.getByRole("button", { name: "Delete" }).click();
    const confirmDialog = pageA.getByRole("dialog").filter({ hasText: "Delete this comment?" });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete" }).click();
    await expect(pageA.getByText(commentText)).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });
});

test.describe("COM-02 — moderación Admin", () => {
  test("Admin oculta el comentario sembrado y deja de ser visible para el Student", async ({ browser }) => {
    const adminCtx = await browser.newContext({ storageState: await storageStateFor(browser, admin.email, admin.password) });
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`/admin/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(adminPage);
    const seededRow = adminPage.locator("div.flex.items-start.justify-between").filter({ hasText: "comentario sembrado para el test de moderación admin" });
    await expect(seededRow).toBeVisible();
    await seededRow.getByRole("button", { name: /ocultar/i }).click();
    await adminCtx.close();

    const studentCtx = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const studentPage = await studentCtx.newPage();
    await studentPage.goto(`/${ieA.community}/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(studentPage);
    await studentPage.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(studentPage.getByText("comentario sembrado para el test de moderación admin")).toHaveCount(0);
    await studentCtx.close();
  });
});

test.describe("COM-02 — scoping cruzado IE/UVA (IDOR)", () => {
  test("un estudiante de UVA no puede comentar una propuesta de IE aunque manipule la URL", async ({ browser }) => {
    // UVA tiene locale por defecto ES (spec: "EN default IE, ES default UVA") —
    // la UI de este estudiante se renderiza en español independientemente de
    // que la propuesta 12 pertenezca a la comunidad IE.
    const context = await browser.newContext({ storageState: await storageStateFor(browser, uvaA.email, uvaA.password) });
    const page = await context.newPage();
    await page.goto(`/${uvaA.community}/comunity/${proposalIds.meApunto}`);
    await dismissCookieBanner(page);
    await page.getByRole("button", { name: /^comentarios$/i }).click();
    const forbiddenText = `[QA COM-02] intento cross-community ${Date.now()}`;
    await page.getByPlaceholder(/escribe un comentario/i).fill(forbiddenText);
    await page.getByRole("button", { name: "Publicar" }).click();
    // El toast de error usa el mensaje real del servidor (FORBIDDEN) — nunca se crea el comentario.
    // (se busca solo entre filas de comentario ya renderizadas — el textarea
    // conserva el texto tras el error y "getByText" puede matchear su valor)
    await expect(page.getByText(/no tienes acceso/i)).toBeVisible();
    await expect(page.locator('[data-testid^="comment-row-"]').getByText(forbiddenText)).toHaveCount(0);
    await context.close();
  });

  test("ese mismo estudiante SÍ puede comentar su propia propuesta de comunidad (UVA)", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, uvaA.email, uvaA.password) });
    const page = await context.newPage();
    await page.goto(`/${uvaA.community}/comunity/${proposalIds.uvaCrossCommunity}`);
    await dismissCookieBanner(page);
    await page.getByRole("button", { name: /^comentarios$/i }).click();
    const text = `[QA COM-02] comentario propio UVA ${Date.now()}`;
    await page.getByPlaceholder(/escribe un comentario/i).fill(text);
    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText(text)).toBeVisible();
    await context.close();
  });
});
