import mysql from "mysql2/promise";
import { test, expect } from "@playwright/test";
import { storageStateFor } from "./fixtures/authState";
import { dismissCookieBanner } from "./fixtures/cookies";
import { ieA, proposalIds } from "./fixtures/credentials-mvote.local";

/**
 * "SEGOLIFE — Bugfix: impedir voto múltiple en /ie/community" — E2E LOCAL
 * (BD real). Repro exacto del bug reportado: listado `/ie/comunity` →
 * pulsar "I'm in" → la tarjeta debe bloquearse INMEDIATAMENTE (sin reload) →
 * seguir bloqueada tras recargar → el detalle debe reflejar la
 * participación (nunca volver a mostrar el formulario de voto) → volver al
 * listado, sigue bloqueado. Verifica también, contra la BD real, que un
 * doble click no crea una segunda fila en community_responses.
 */
async function countResponses(proposalId: number, userId: number): Promise<number> {
  const c = await mysql.createConnection("mysql://nayade:nayade_pass@localhost:3307/nayade_db");
  try {
    const [rows] = await c.execute(
      "SELECT COUNT(*) AS n FROM community_responses WHERE proposal_id = ? AND user_id = ?",
      [proposalId, userId]
    ) as unknown as [{ n: number }[], unknown];
    return Number(rows[0].n);
  } finally {
    await c.end();
  }
}

test.describe("me_apunto ('I'm in') — bloqueo inmediato, persistente, consistente con el detalle", () => {
  test("votar bloquea la tarjeta sin reload, sigue bloqueada tras recargar, y el detalle nunca vuelve a ofrecer votar", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity`);
    await dismissCookieBanner(page);

    const imInButton = page.getByRole("button", { name: /i'm in/i });
    await expect(imInButton).toBeVisible();
    await expect(imInButton).toBeEnabled();

    await imInButton.click();

    // Bloqueo INMEDIATO, sin reload (spec §6: "la UI no debe requerir reload").
    const lockedButton = page.getByRole("button", { name: /already joined/i });
    await expect(lockedButton).toBeVisible();
    await expect(lockedButton).toBeDisabled();
    await expect(page.getByRole("button", { name: /^🙋 i'm in$/i })).toHaveCount(0);

    // Un segundo click sobre el botón ya bloqueado no debe hacer nada (está disabled).
    await lockedButton.click({ force: true }).catch(() => {});
    expect(await countResponses(proposalIds.meApuntoActive, ieA.userId)).toBe(1);

    // Persiste tras recargar (spec §7: "no depender de que haya votado durante la sesión actual").
    await page.reload();
    await dismissCookieBanner(page);
    await expect(page.getByRole("button", { name: /already joined/i })).toBeDisabled();

    // El detalle nunca debe volver a ofrecer "I'm in" — muestra la vista social (like/comment/share) en su lugar.
    await page.goto(`/${ieA.community}/comunity/${proposalIds.meApuntoActive}`);
    await expect(page.getByRole("button", { name: /^🙋 i'm in$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();

    // Volver al listado — sigue bloqueado (misma fuente de verdad que el detalle).
    await page.goto(`/${ieA.community}/comunity`);
    await expect(page.getByRole("button", { name: /already joined/i })).toBeDisabled();

    expect(await countResponses(proposalIds.meApuntoActive, ieA.userId)).toBe(1);
    await context.close();
  });
});

test.describe("yes_no — bloqueo tras responder, consistente con 'Your response' en el detalle", () => {
  test("responder Yes bloquea la tarjeta, y el detalle muestra 'Your response: Yes' sin ofrecer volver a votar", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await storageStateFor(browser, ieA.email, ieA.password) });
    const page = await context.newPage();
    await page.goto(`/${ieA.community}/comunity`);
    await dismissCookieBanner(page);

    await page.getByRole("button", { name: /^👍 yes$/i }).click();
    const lockedButton = page.getByRole("button", { name: /already answered/i });
    await expect(lockedButton).toBeVisible();
    await expect(lockedButton).toBeDisabled();

    await page.goto(`/${ieA.community}/comunity/${proposalIds.yesNoActive}`);
    await expect(page.getByText(/your response:.*yes/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();

    expect(await countResponses(proposalIds.yesNoActive, ieA.userId)).toBe(1);
    await context.close();
  });
});
