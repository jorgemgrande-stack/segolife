import { test, expect } from "@playwright/test";
import { admin, student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * STU-01 — Student Admin Controls (Editar/Ocultar/Borrar), contra
 * producción real. Mismo criterio de datos QA que com01-student-messages.spec.ts:
 * este spec SÍ crea una cuenta real (`[QA STU-01] Delete Test`, vacía a
 * propósito, sin tokens/tickets/pedidos) — autorizado explícitamente por el
 * spec de la fase para probar el borrado físico de verdad, y ESA cuenta
 * queda eliminada al final del propio test (ese es el resultado esperado,
 * no un efecto secundario). La cuenta QA `student` pre-existente (con
 * histórico real de COM-01) se usa SOLO en modo lectura — se abre su
 * diálogo de borrado para confirmar que el bloqueo funciona, y se cancela
 * sin confirmar nunca; Ocultar/Mostrar se prueba sobre ella y se revierte
 * al estado original antes de terminar.
 *
 * Toda acción se busca DENTRO de la fila de la tabla que contiene el email
 * exacto (nunca `getByRole("button", ...).first()` sobre la página
 * entera) — el listado por defecto puede mostrar más de una fila con el
 * mismo nombre visible (ejecuciones previas de este mismo spec), y sin
 * este scoping un test podría accionar por error sobre la fila de otra
 * cuenta.
 */
async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

function studentRow(page: import("@playwright/test").Page, email: string) {
  return page.locator("table tbody tr", { hasText: email });
}

async function searchFor(page: import("@playwright/test").Page, email: string) {
  await page.goto("/admin/students");
  await page.getByPlaceholder(/buscar por nombre o email/i).fill(email);
  await expect(studentRow(page, email)).toBeVisible({ timeout: 10000 });
}

const QA_DELETE_EMAIL = `qa-stu01-delete-${Date.now()}@segolife.es`;

test.describe.serial("STU-01 — Editar/Ocultar/Borrar contra producción (datos QA)", () => {
  test("registra la cuenta QA vacía usada para probar el borrado físico real", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/register?community=${student.community}`);
    await dismissCookies(page);
    await page.locator("#firstName").fill("QA");
    await page.locator("#lastName").fill("STU01DeleteTest");
    await page.locator("#email").fill(QA_DELETE_EMAIL);
    await page.locator("#phone").fill("600000099");
    await page.locator("#password").fill("Stu01Delete123!");
    await page.locator("#passwordConfirm").fill("Stu01Delete123!");
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.locator("#acceptTerms").click();
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes("/api/auth/register")),
      page.getByRole("button", { name: "Crear mi cuenta" }).click(),
    ]);
    expect(response.status()).toBe(201);
  });

  test("Admin: Editar actualiza un campo real de la cuenta QA vacía", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await searchFor(page, QA_DELETE_EMAIL);
    await studentRow(page, QA_DELETE_EMAIL).getByRole("button", { name: /^editar/i }).click();
    await expect(page.getByRole("dialog", { name: /editar estudiante/i })).toBeVisible();
    await page.getByLabel(/^teléfono$/i).fill("600000098");
    await page.getByRole("button", { name: /guardar cambios/i }).click();
    await expect(page.getByText(/estudiante actualizado/i)).toBeVisible({ timeout: 10000 });
  });

  test("Admin: Borrar sobre la cuenta QA vacía SÍ permite confirmar y elimina de verdad", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await searchFor(page, QA_DELETE_EMAIL);
    await studentRow(page, QA_DELETE_EMAIL).getByRole("button", { name: /^eliminar/i }).click();
    await expect(page.getByRole("dialog", { name: /eliminar este estudiante/i })).toBeVisible();
    // Cuenta genuinamente vacía → nunca debe mostrar bloqueos falsos.
    await expect(page.getByText(/no se puede eliminar/i)).not.toBeVisible();
    await page.getByLabel(/^motivo$/i).fill("STU-01 — verificación de producción, cuenta QA vacía");
    await page.getByRole("button", { name: /^eliminar$/i }).click();
    await expect(page.getByText(/estudiante eliminado/i)).toBeVisible({ timeout: 10000 });

    // Confirma que de verdad desapareció del listado (nunca solo el toast).
    await page.goto("/admin/students");
    await page.getByPlaceholder(/buscar por nombre o email/i).fill(QA_DELETE_EMAIL);
    await expect(studentRow(page, QA_DELETE_EMAIL)).toHaveCount(0, { timeout: 10000 });
  });

  test("Admin: Borrar sobre la cuenta QA CON histórico real (COM-01) se BLOQUEA — nunca se confirma, nunca se toca", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await searchFor(page, student.email);
    await studentRow(page, student.email).getByRole("button", { name: /^eliminar/i }).click();
    await expect(page.getByRole("dialog", { name: /eliminar este estudiante/i })).toBeVisible();
    await expect(page.getByText(/no se puede eliminar/i)).toBeVisible({ timeout: 10000 });
    // Sin botón de confirmación real cuando está bloqueado — nunca una
    // confirmación falsa (spec §22).
    await expect(page.getByRole("dialog").getByRole("button", { name: /^eliminar$/i })).toHaveCount(0);
    await page.getByRole("button", { name: /cancelar/i }).click();
  });

  test("Admin: Ocultar/Mostrar sobre la cuenta QA con histórico es reversible, sin dejar rastro", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await searchFor(page, student.email);
    const toggleBtn = studentRow(page, student.email).getByRole("button", { name: /^(ocultar|mostrar) estudiante$/i });
    const initialTitle = await toggleBtn.getAttribute("title");

    await toggleBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel(/^motivo$/i).fill("STU-01 — verificación de producción, reversible");
    await page.getByRole("button", { name: /^(ocultar|mostrar)$/i }).click();
    await expect(page.getByText(/estado actualizado/i)).toBeVisible({ timeout: 10000 });

    // Revierte exactamente al estado original — nunca deja la cuenta QA en un estado distinto del que tenía.
    await searchFor(page, student.email);
    const revertBtn = studentRow(page, student.email).getByRole("button", { name: /^(ocultar|mostrar) estudiante$/i });
    await expect(revertBtn).toHaveAttribute("title", initialTitle ?? /.*/);
    await revertBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel(/^motivo$/i).fill("STU-01 — revertir a estado original");
    await page.getByRole("button", { name: /^(ocultar|mostrar)$/i }).click();
    await expect(page.getByText(/estado actualizado/i)).toBeVisible({ timeout: 10000 });
  });
});
