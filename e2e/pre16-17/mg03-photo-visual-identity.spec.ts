import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { student, allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * MG-03 — identidad visual en el Venue App: el Student QA sube una foto,
 * un Venue QA la resuelve escaneando el QR permanente de identidad (aquí
 * vía "Introducir código" con el token real obtenido por API — Playwright
 * no puede decodificar visualmente un <QRCodeSVG>, así que el token se lee
 * de la MISMA sesión autenticada del propio Student en vez de simular una
 * cámara, spec §24: "si la resolución requiere cámara física, cubre
 * backend/componente de forma determinista" — aquí SÍ podemos accionar el
 * flujo real de principio a fin sin cámara, vía el fallback de entrada
 * manual que la propia UI ya ofrece para este caso).
 *
 * Sin mutación económica: `staffCheckin.checkIn` con el token de identidad
 * (no un ticket) resuelve a "visit_recorded"/"visit_already_recorded" —
 * registra una visita de venue (no económica, mismo criterio ya usado en
 * bloques E2E anteriores de este proyecto), nunca SegoTokens/Benefits/
 * check-in de entrada.
 *
 * Dos contextos de navegador independientes (Student / Venue) — nunca la
 * misma sesión, para que la comprobación de que el Venue ve la foto sea
 * real y no un artefacto de compartir cookies.
 */

const QA_IMAGE_PATH = path.join(__dirname, "fixtures", "mg03-qa-avatar.jpg");

async function fetchMyIdentityToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const input = encodeURIComponent(JSON.stringify({ 0: { json: null } }));
  const res = await request.get(`https://www.segolife.es/api/trpc/ticketPurchase.myIdentityToken?batch=1&input=${input}`);
  expect(res.ok(), `myIdentityToken respondió ${res.status()}`).toBe(true);
  const body = await res.json();
  return body[0].result.data.json.token as string;
}

async function removeMyPhotoViaApi(request: import("@playwright/test").APIRequestContext) {
  await request.post("https://www.segolife.es/api/trpc/students.removeMyPhoto?batch=1", {
    data: { 0: { json: null } },
  }).catch(() => {});
}

test.describe("MG-03 — identidad visual en el Venue App (QR/operador)", () => {
  test("Student sube foto → Venue la resuelve por identidad → la ficha operativa muestra la foto real", async ({ browser }) => {
    const venue = allVenueAccounts()[0];
    test.skip(!venue, "ninguna cuenta de Venue QA configurada en .env.e2e.local — DATA STATE");

    const studentContext = await browser.newContext();
    const venueContext = await browser.newContext();
    try {
      const studentPage = await studentContext.newPage();
      await loginViaUI(studentPage, student.email, student.password);
      await studentPage.goto(`/${student.community}/profile`);
      await studentPage.waitForLoadState("networkidle");
      await studentPage.locator('input[type="file"]').setInputFiles(QA_IMAGE_PATH);
      await expect(studentPage.getByText(/remove photo|eliminar foto/i)).toBeVisible({ timeout: 15000 });

      const identityToken = await fetchMyIdentityToken(studentPage.request);
      expect(identityToken.length).toBeGreaterThan(10);

      const venuePage = await venueContext.newPage();
      await loginViaUI(venuePage, venue.email, venuePassword());
      await venuePage.goto("/admin/mi-local");
      await venuePage.waitForLoadState("networkidle");
      await venuePage.getByRole("navigation").getByRole("button", { name: "Escanear" }).click();
      await venuePage.getByRole("button", { name: /introducir código/i }).click();
      await venuePage.getByPlaceholder(/código escaneado/i).fill(identityToken);
      await venuePage.getByRole("button", { name: "OK" }).click();

      // Ficha Operativa (StudentCard) — la foto llega YA embebida como data
      // URI en la misma respuesta autorizada de venueApp.studentCard, nunca
      // como una URL /api/students/... aparte (spec §10/§13 — sin endpoint
      // nuevo explotable por el Venue).
      const photoImg = venuePage.locator('img[src^="data:image/jpeg;base64,"]');
      await expect(photoImg.first()).toBeVisible({ timeout: 15000 });

      // Minimización de datos (spec §9) — la ficha NO debe mostrar email/teléfono/fecha de nacimiento.
      await expect(venuePage.getByText(student.email)).not.toBeVisible();
    } finally {
      await removeMyPhotoViaApi(studentContext.request);
      await studentContext.close();
      await venueContext.close();
    }
  });
});
