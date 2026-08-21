import { test, expect } from "@playwright/test";
import { admin, student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * LNF-01 — QA visual (spec §36). Solo NAVEGACIÓN + capturas, ninguna
 * mutación — reutiliza el caso QA #4 ya cerrado por
 * lnf01-lost-found.spec.ts (nunca crea datos nuevos solo para una captura).
 * Corre en los 3 proyectos de playwright.production.config.ts (desktop
 * 1440×900 vía el matcher por defecto, tablet 1024×768 y mobile 390×844 vía
 * el sufijo .responsive.spec.ts) — mismo mecanismo ya usado en este
 * directorio, ninguna config nueva.
 */
const QA_REPORT_ID = 4;

function dismissCookies(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /accept all|aceptar todas/i }).click({ timeout: 3000 }).catch(() => {});
}

test.describe("LNF-01 — QA visual (desktop/tablet/mobile)", () => {
  test("Venue detail — CTA Objeto perdido", async ({ page }, testInfo) => {
    await page.goto(`/${student.community}/venues/casanova`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);
    await page.screenshot({ path: testInfo.outputPath("01-venue-detail.png"), fullPage: true });
  });

  test("Formulario Lost Item (con sesión Student)", async ({ page }, testInfo) => {
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);
    await page.goto(`/${student.community}/venues/casanova/lost-item`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: testInfo.outputPath("02-lost-item-form.png"), fullPage: true });
  });

  test("Student — Mis objetos perdidos + detalle de un caso", async ({ page }, testInfo) => {
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);
    await page.goto(`/${student.community}/lost-items`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: testInfo.outputPath("03-my-lost-items.png"), fullPage: true });

    await page.goto(`/${student.community}/lost-items/${QA_REPORT_ID}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: testInfo.outputPath("04-lost-item-detail.png"), fullPage: true });
  });

  test("Admin — listado y detalle del caso, con conversación", async ({ page }, testInfo) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);
    await page.goto("/admin/lost-found");
    await page.waitForLoadState("domcontentloaded");
    // domcontentloaded no basta — la página es un chunk lazy + su propia
    // query tRPC, esperar a un elemento real evita capturar solo el spinner.
    await expect(page.getByRole("heading", { name: /objetos perdidos/i })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: testInfo.outputPath("05-admin-list.png"), fullPage: true });

    await page.goto(`/admin/lost-found/${QA_REPORT_ID}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/^cerrado — no encontrado$/i)).toBeVisible({ timeout: 15000 });
    // La conversación embebida es una segunda query aparte (adminGetConversation)
    // — esperar también a que resuelva, o la captura solo tendría su spinner.
    await expect(page.getByRole("button", { name: /^enviar$/i })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: testInfo.outputPath("06-admin-detail.png"), fullPage: true });
  });
});
