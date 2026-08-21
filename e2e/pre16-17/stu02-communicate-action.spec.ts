import { test, expect } from "@playwright/test";
import { admin, student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * STU-02 — "Comunicarse" desde /admin/students y /admin/students/:id,
 * contra producción real. Reutiliza 100% COM-01 (ninguna tabla/endpoint
 * nuevo) — lo que se prueba aquí es que el botón localiza/crea la
 * conversación general de forma idempotente y que ambas superficies
 * (listado y ficha) llegan exactamente al mismo hilo. Usa la cuenta QA
 * `student` ya existente (con histórico real de COM-01/FIX-07, incluida
 * una conversación general que puede estar cerrada) — nunca un Student
 * real; el mensaje que se envía aquí queda prefijado `[QA STU-02]` cuando
 * el spec es quien crea la conversación por primera vez.
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

/** Tras pulsar Comunicarse: o bien navega directo a un hilo existente, o abre el diálogo de creación (primera vez real). Devuelve la URL de la conversación en ambos casos. */
async function resolveConversationUrl(page: import("@playwright/test").Page, subjectIfNew: string): Promise<string> {
  await Promise.race([
    page.waitForURL(/\/admin\/students\/messages\/\d+/, { timeout: 8000 }).catch(() => {}),
    page.getByRole("dialog", { name: /comunicarse con el student/i }).waitFor({ timeout: 8000 }).catch(() => {}),
  ]);

  if (/\/admin\/students\/messages\/\d+/.test(page.url())) {
    return page.url();
  }

  await expect(page.getByRole("dialog", { name: /comunicarse con el student/i })).toBeVisible();
  await page.getByPlaceholder(/asunto de la conversaci[oó]n/i).fill(subjectIfNew);
  await page.getByPlaceholder(/escribe tu mensaje/i).fill("Mensaje inicial QA STU-02.");
  await page.getByRole("button", { name: /iniciar conversaci[oó]n/i }).click();
  await page.waitForURL(/\/admin\/students\/messages\/\d+/, { timeout: 10000 });
  return page.url();
}

const ADMIN_MESSAGE = `[QA STU-02] mensaje de Admin ${Date.now()}`;
const STUDENT_REPLY = `Recibido, respuesta QA STU-02 ${Date.now()}.`;

test.describe.serial("STU-02 — Comunicarse (listado + ficha) contra producción (datos QA)", () => {
  let conversationUrl = "";
  let conversationId = "";

  test("Admin: el listado muestra Comunicarse, convive con Editar/Ocultar/Borrar, y localiza o crea la conversación general", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await searchFor(page, student.email);
    const row = studentRow(page, student.email);
    await expect(row.getByRole("button", { name: /^editar/i })).toBeVisible();
    await expect(row.locator('button[title="Ocultar estudiante"], button[title="Mostrar estudiante"]')).toBeVisible();
    await expect(row.getByRole("button", { name: /^eliminar/i })).toBeVisible();

    const communicateBtn = row.getByRole("button", { name: /comunicarse/i });
    await expect(communicateBtn).toBeVisible();
    await communicateBtn.click();

    conversationUrl = await resolveConversationUrl(page, `[QA STU-02] ${Date.now()}`);
    conversationId = conversationUrl.match(/messages\/(\d+)/)?.[1] ?? "";
    expect(conversationId).toBeTruthy();
  });

  test("Admin: si el hilo estaba cerrado lo reabre (nunca crea uno nuevo) y envía un mensaje real", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto(conversationUrl);
    await page.waitForLoadState("domcontentloaded");

    // Espera al estado REAL (Abierta/Cerrada) antes de decidir — la
    // conversación se carga vía tRPC después de domcontentloaded, así que
    // un isVisible() inmediato aquí devolvería false solo por timing, nunca
    // por el estado real (isVisible() no espera a que aparezca, a
    // diferencia de expect(...).toBeVisible()).
    await expect(page.getByText(/^(abierta|cerrada)$/i)).toBeVisible({ timeout: 10000 });
    const isClosed = await page.getByText(/^cerrada$/i).isVisible();
    if (isClosed) {
      await page.getByRole("button", { name: /^reabrir$/i }).click();
      await expect(page.getByText(/conversación reabierta/i)).toBeVisible({ timeout: 10000 });
    }

    await page.getByPlaceholder(/escribe tu respuesta/i).fill(ADMIN_MESSAGE);
    await page.getByRole("button", { name: /enviar respuesta/i }).click();
    await expect(page.getByText(ADMIN_MESSAGE)).toBeVisible({ timeout: 10000 });
  });

  test("Student: recibe el mensaje vía COM-01 (notification/hilo existente) y responde — waitingFor pasa a admin", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await page.goto(`/${student.community}/messages/${conversationId}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(ADMIN_MESSAGE)).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder(/write a reply|escribe una respuesta/i).fill(STUDENT_REPLY);
    await page.getByRole("button", { name: /send|enviar/i }).click();
    // .first(): scope a <p> (el textarea aún no limpio en el mismo instante
    // también contiene el texto tal cual) + tolera más de un mensaje real
    // idéntico si este mismo spec ya se ejecutó antes contra esta cuenta QA
    // compartida — no es un bug, es histórico QA acumulado real.
    await expect(page.locator("p", { hasText: STUDENT_REPLY }).first()).toBeVisible({ timeout: 10000 });
  });

  test("Admin: ve la respuesta como pendiente en Estudiantes → Mensajes (nunca un indicador nuevo de STU-02)", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto("/admin/students/messages");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(STUDENT_REPLY).or(page.locator("table tbody tr", { hasText: student.email }))).toBeVisible({ timeout: 10000 });

    await page.goto(conversationUrl);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(STUDENT_REPLY)).toBeVisible();
  });

  test("Admin: Comunicarse desde Student Detail abre EXACTAMENTE el mismo hilo — nunca crea uno nuevo", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await searchFor(page, student.email);
    await studentRow(page, student.email).getByRole("link").first().click();
    await page.waitForLoadState("domcontentloaded");

    const headerCommunicateBtn = page.getByRole("button", { name: /^comunicarse con este estudiante$/i });
    await expect(headerCommunicateBtn).toBeVisible();
    await headerCommunicateBtn.click();
    await page.waitForURL(/\/admin\/students\/messages\/\d+/, { timeout: 10000 });

    const reachedId = page.url().match(/messages\/(\d+)/)?.[1];
    expect(reachedId).toBe(conversationId);
  });

  test("limpieza: cierra la conversación QA de nuevo — mismo estado limpio con el que terminaba COM-01, nunca se borra", async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, admin.email, admin.password);
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    await page.goto(conversationUrl);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(/^(abierta|cerrada)$/i)).toBeVisible({ timeout: 10000 });
    if (await page.getByText(/^abierta$/i).isVisible()) {
      await page.getByRole("button", { name: /^cerrar$/i }).click();
      await expect(page.getByText(/conversación cerrada/i)).toBeVisible({ timeout: 10000 });
    }
  });
});
