import { test, expect } from "@playwright/test";
import { admin, student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * SUPERPROMPT FINAL REMAINING ACTIONS — QA visual real (Chromium/Playwright)
 * de /admin/students y /admin/students/:id en los 3 viewports, pendiente
 * explícito de STU-01/STU-02 (sus propios cierres solo verificaron desktop +
 * un spec funcional). Solo NAVEGACIÓN + capturas, ninguna mutación — usa la
 * cuenta QA Student ya existente, nunca crea datos nuevos.
 */
function dismissCookies(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /accept all|aceptar todas/i }).click({ timeout: 3000 }).catch(() => {});
}

function studentRow(page: import("@playwright/test").Page, email: string) {
  return page.locator("table tbody tr", { hasText: email });
}

test.describe("STU Admin — QA visual responsive (desktop/tablet/mobile)", () => {
  test("Listado /admin/students — tabla, columna Acciones (Editar/Ocultar/Borrar/Comunicarse)", async ({ page }, testInfo) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto("/admin/students");
    await page.waitForLoadState("domcontentloaded");
    await page.getByPlaceholder(/buscar por nombre o email/i).fill(student.email);
    await expect(studentRow(page, student.email)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath("01-students-list.png"), fullPage: true });
  });

  test("Ficha /admin/students/:id — cabecera, botones, Comunicarse", async ({ page }, testInfo) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto("/admin/students");
    await page.waitForLoadState("domcontentloaded");
    await page.getByPlaceholder(/buscar por nombre o email/i).fill(student.email);
    const row = studentRow(page, student.email);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole("link").first().click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("button", { name: /comunicarse/i })).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath("02-student-detail.png"), fullPage: true });
  });

  test("Modal Editar — overlay, campos, sin overflow", async ({ page }, testInfo) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto("/admin/students");
    await page.waitForLoadState("domcontentloaded");
    await page.getByPlaceholder(/buscar por nombre o email/i).fill(student.email);
    const row = studentRow(page, student.email);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole("button", { name: /^editar/i }).click();
    // Espera al campo real (no solo al role="dialog") — el diálogo carga su
    // propia query antes de pintar el formulario; sin esto la captura cae en
    // mitad de la animación de entrada/carga (fondo transparentándose).
    await expect(page.locator("#stu-edit-firstName")).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath("03-edit-modal.png"), fullPage: true });
    // Cierra sin guardar — spec de solo lectura visual, ninguna mutación.
    await page.keyboard.press("Escape");
  });
});
