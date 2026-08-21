import path from "path";
import { fileURLToPath } from "url";
import { test, expect } from "@playwright/test";
import { admin, student, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_PHOTO_PATH = path.join(__dirname, "fixtures", "mg03-qa-avatar.jpg");

/**
 * LNF-01 — Lost & Found / Objetos perdidos, circuito completo contra
 * producción real (datos QA). Reutiliza la cuenta Student QA
 * (`qa.pre1617.ie@`, comunidad "ie") en el venue real "casanova" (id=1,
 * mismo venue del que existe la cuenta venue_admin QA `casanova@segolife.es`
 * — venue_staff activo confirmado antes de escribir este spec), la cuenta
 * Admin QA global, y COM-01 tal cual para la conversación del caso (nunca un
 * chat/notificación paralelos). El caso QA se deja CERRADO (closed_not_found)
 * al final, identificado con el prefijo `[QA LNF-01]` en su descripción — no
 * se borra (spec §21: Lost & Found nunca tiene "Borrar", solo estado).
 */
function dismissCookies(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /accept all|aceptar todas/i }).click({ timeout: 3000 }).catch(() => {});
}

const DESCRIPTION = `[QA LNF-01] Cartera de cuero marrón perdida en la barra ${Date.now()}`;
const ADMIN_REPLY = `[QA LNF-01] Admin: hemos localizado un objeto que coincide ${Date.now()}`;
const RESOLUTION_NOTE = `[QA LNF-01] Hemos encontrado tu cartera, pásate por la entrada del local a recogerla ${Date.now()}`;
const STUDENT_REPLY = `[QA LNF-01] Student: perfecto, paso a recogerla ${Date.now()}`;
const CLOSE_NOTE = `[QA LNF-01] Caso de prueba automatizada — cerrado tras verificación E2E, no corresponde a un objeto real.`;

test.describe.serial("LNF-01 — Lost & Found end-to-end contra producción (datos QA)", () => {
  let reportId = "";
  let conversationId = "";

  test("Student: informa de un objeto perdido desde la ficha del venue (Casanova)", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await page.goto(`/${student.community}/venues/casanova`);
    await page.waitForLoadState("networkidle");

    const ctaBtn = page.getByRole("button", { name: /lost item|objeto perdido/i });
    await expect(ctaBtn).toBeVisible({ timeout: 10000 });
    await ctaBtn.click();
    await page.waitForURL(/\/ie\/venues\/casanova\/lost-item/, { timeout: 10000 });

    // Autofill de identidad — solo lectura, nunca editable aquí (spec §2).
    await expect(page.getByText(student.email)).toBeVisible({ timeout: 10000 });

    await page.locator("#lnf-lostDate").fill(new Date().toISOString().slice(0, 10));
    await page.locator("#lnf-approxTime").fill("18:30");
    await page.locator("#lnf-description").fill(DESCRIPTION);
    await page.locator("#lnf-photo").setInputFiles(QA_PHOTO_PATH);
    await expect(page.locator("img[alt='']")).toBeVisible({ timeout: 5000 }); // preview local antes de enviar

    await page.getByRole("button", { name: /^submit$|^enviar$/i }).click();
    await expect(page.getByText(/report sent|informe enviado|enviado/i)).toBeVisible({ timeout: 15000 });

    await page.getByRole("link", { name: /my lost items|mis objetos perdidos/i }).click();
    await page.waitForURL(/\/ie\/lost-items$/, { timeout: 10000 });

    const row = page.locator("a", { hasText: DESCRIPTION });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText(/still searching|en búsqueda/i)).toBeVisible();
    await row.click();
    await page.waitForURL(/\/ie\/lost-items\/\d+/, { timeout: 10000 });
    reportId = page.url().match(/lost-items\/(\d+)/)?.[1] ?? "";
    expect(reportId).toBeTruthy();
  });

  test("Admin (global): localiza el caso en /admin/lost-found, ve los datos del Student, responde y marca Encontrado", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto("/admin/lost-found");
    await page.waitForLoadState("domcontentloaded");
    // La tabla no renderiza la descripción (solo Estudiante/Venue/Fecha/Estado)
    // — se busca por la descripción (server-side, SQL LIKE) para acotar a
    // exactamente esta fila QA, y se localiza la única fila resultante.
    await page.getByPlaceholder(/buscar por estudiante o descripci[oó]n/i).fill(DESCRIPTION);
    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(1, { timeout: 10000 });
    await rows.first().getByRole("link", { name: /abrir/i }).click();
    await page.waitForURL(/\/admin\/lost-found\/\d+/, { timeout: 10000 });

    await expect(page.getByText(student.email)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Casanova")).toBeVisible();
    // .first(): la descripción aparece DOS veces a propósito — en el
    // detalle del caso Y como primer mensaje real de la conversación COM-01
    // (spec §10: el primer mensaje ES la descripción, nunca uno artificial).
    await expect(page.getByText(DESCRIPTION).first()).toBeVisible();

    await page.getByPlaceholder(/escribe un mensaje al student/i).fill(ADMIN_REPLY);
    await page.getByRole("button", { name: /^enviar$/i }).click();
    await expect(page.getByText(ADMIN_REPLY)).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder(/mensaje para el student/i).fill(RESOLUTION_NOTE);
    await page.getByRole("button", { name: /marcar encontrado/i }).click();
    await expect(page.getByText(/^encontrado$/i)).toBeVisible({ timeout: 10000 });
    // .first(): la nota de resolución aparece en 3 sitios a la vez a
    // propósito (tarjeta "última nota"/historial de auditoría/mensaje real
    // de la conversación, spec §9) — cualquiera de los tres confirma que se
    // guardó y se comunicó.
    await expect(page.getByText(RESOLUTION_NOTE).first()).toBeVisible({ timeout: 10000 });
  });

  test("Student: ve el caso como Encontrado, lee la resolución y la respuesta del Admin, y responde", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await page.goto(`/ie/lost-items/${reportId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/^found$|^encontrado$/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(RESOLUTION_NOTE)).toBeVisible();

    await page.getByRole("button", { name: /view conversation|ver conversaci[oó]n/i }).click();
    await page.waitForURL(/\/ie\/messages\/\d+/, { timeout: 10000 });
    conversationId = page.url().match(/messages\/(\d+)/)?.[1] ?? "";
    expect(conversationId).toBeTruthy();

    await expect(page.getByText(ADMIN_REPLY)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(RESOLUTION_NOTE)).toBeVisible();

    await page.getByPlaceholder(/write a reply|escribe una respuesta/i).fill(STUDENT_REPLY);
    await page.getByRole("button", { name: /send|enviar/i }).click();
    await expect(page.locator("p", { hasText: STUDENT_REPLY }).first()).toBeVisible({ timeout: 10000 });
  });

  test("Admin (global): detecta la respuesta pendiente del Student en el caso", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto(`/admin/lost-found/${reportId}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(STUDENT_REPLY)).toBeVisible({ timeout: 10000 });
  });

  test("venue_admin (Casanova): ve el caso desde la pestaña 'Perdidos' de la Venue App, acotado a su propio venue", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, "casanova@segolife.es", venuePassword());
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    // Un único venue autorizado (venue_staff activo solo en Casanova) entra
    // directo a la Venue App sin selector — mismo criterio que el resto de
    // pestañas (Hoy/TPV/etc.), confirmado antes de escribir este spec.
    await page.goto("/admin/mi-local");
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: /perdidos/i }).click();

    const row = page.getByText(DESCRIPTION, { exact: false });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();
    await expect(page.getByText(student.email)).toBeVisible({ timeout: 10000 });
    // Alcance por venue (spec §14/§25): NUNCA ve el CRM completo del Student
    // desde aquí, solo lo mínimo ya expuesto por adminGet (name/email/phone).
    await expect(page.getByText(/^encontrado$/i)).toBeVisible();
  });

  test("limpieza: reabre y cierra el caso QA como 'no encontrado', identificado como QA — nunca se borra (spec §21)", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto(`/admin/lost-found/${reportId}`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByPlaceholder(/motivo de la reapertura/i).fill(CLOSE_NOTE);
    await page.getByRole("button", { name: /^reabrir$/i }).click();
    await expect(page.getByText(/^abierto$/i)).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder(/mensaje para el student/i).fill(CLOSE_NOTE);
    await page.getByRole("button", { name: /marcar perdido definitivamente/i }).click();
    await expect(page.getByText(/cerrado — no encontrado/i)).toBeVisible({ timeout: 10000 });
  });
});
