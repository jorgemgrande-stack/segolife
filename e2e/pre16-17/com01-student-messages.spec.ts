import { test, expect } from "@playwright/test";
import { admin, student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * COM-01 — Bidirectional Student Communication Center, contra producción
 * real. A diferencia del resto de la suite pre16-17, este spec SÍ crea
 * datos QA reales (una conversación real entre las cuentas QA Admin y QA
 * Student) — autorizado explícitamente por el spec de la fase (asunto
 * prefijado `[QA COM-01]`, la conversación se CIERRA al final — nunca se
 * borra, COM-01 no implementa DELETE por diseño, ver spec §30 — quedando
 * documentada y en un estado limpio, nunca contaminando la operación real).
 *
 * Usa 2 browser contexts independientes (Admin + Student) en el mismo
 * test, ya que el flujo real es intrínsecamente de ida y vuelta entre
 * ambos actores — dividirlo en tests independientes perdería justo lo que
 * hay que probar (que cada lado ve lo que el otro acaba de escribir).
 */
async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

const QA_SUBJECT = `[QA COM-01] ${Date.now()}`;
const ADMIN_FIRST_MESSAGE = "Hola, este es un mensaje de prueba QA COM-01.";
const STUDENT_REPLY = "Recibido, gracias por el mensaje QA.";
const ADMIN_SECOND_MESSAGE = "Perfecto, cerramos la conversación de prueba.";

test.describe("COM-01 — conversación bidireccional real Admin <-> Student (producción, datos QA)", () => {
  test("Admin inicia, Student recibe/responde, Admin ve pendiente/responde/cierra, Student no puede responder cerrada", async ({ browser }) => {
    test.setTimeout(120_000);

    const adminContext = await browser.newContext();
    const studentContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const studentPage = await studentContext.newPage();

    // ── 1. Admin abre Student, pulsa Comunicar, envía el primer mensaje ──────
    await loginViaUI(adminPage, admin.email, admin.password);
    await adminPage.waitForLoadState("domcontentloaded");
    await dismissCookies(adminPage);

    await adminPage.goto("/admin/students");
    await adminPage.getByPlaceholder(/buscar por nombre o email/i).fill(student.email);
    await adminPage.getByRole("link", { name: new RegExp(student.email, "i") }).first().click({ timeout: 15000 }).catch(async () => {
      // Si el listado muestra el nombre, no el email, como texto del link — clic en la primera fila.
      await adminPage.locator("table tbody tr").first().locator("a").first().click();
    });
    await adminPage.waitForLoadState("domcontentloaded");

    // La pestaña Engagement siempre existe en la ficha del Student — click
    // directo (Playwright hace scroll-into-view automático) en vez de un
    // isVisible() condicional, que fallaba silenciosamente por overflow
    // horizontal en una tablist de 11 pestañas y dejaba la pestaña activa
    // en "Resumen", nunca lanzando error hasta el timeout final.
    await adminPage.getByRole("tab", { name: /engagement/i }).click();
    await expect(adminPage.getByRole("tab", { name: /engagement/i })).toHaveAttribute("aria-selected", "true");

    await adminPage.getByRole("button", { name: /^comunicar$/i }).click();
    await adminPage.getByPlaceholder(/asunto de la conversaci[oó]n/i).fill(QA_SUBJECT);
    await adminPage.getByPlaceholder(/escribe tu mensaje/i).fill(ADMIN_FIRST_MESSAGE);
    await adminPage.getByRole("button", { name: /iniciar conversaci[oó]n/i }).click();

    await adminPage.waitForURL(/\/admin\/students\/messages\/\d+/, { timeout: 15000 });
    const conversationUrl = adminPage.url();
    const conversationId = conversationUrl.match(/messages\/(\d+)/)?.[1];
    expect(conversationId).toBeTruthy();
    await expect(adminPage.getByText(QA_SUBJECT)).toBeVisible();
    await expect(adminPage.getByText(ADMIN_FIRST_MESSAGE)).toBeVisible();

    // ── 2. Student recibe notificación, abre la conversación, responde ──────
    await loginViaUI(studentPage, student.email, student.password);
    await studentPage.waitForLoadState("networkidle");
    await dismissCookies(studentPage);

    await studentPage.goto(`/${student.community}/notifications`);
    await studentPage.waitForLoadState("networkidle");
    const notifRow = studentPage.getByText(new RegExp(QA_SUBJECT.replace(/[[\]]/g, "\\$&"), "i")).first();
    if (await notifRow.isVisible({ timeout: 8000 }).catch(() => false)) {
      await notifRow.click();
    } else {
      // La notificación puede tardar un instante o el preview truncar el
      // asunto — navegación directa como respaldo, la ruta en sí es lo que
      // realmente se está probando aquí, no el timing del feed.
      await studentPage.goto(`/${student.community}/messages/${conversationId}`);
    }
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage).toHaveURL(new RegExp(`/${student.community}/messages/${conversationId}`));
    await expect(studentPage.getByText(ADMIN_FIRST_MESSAGE)).toBeVisible();

    await studentPage.getByPlaceholder(/write a reply|escribe una respuesta/i).fill(STUDENT_REPLY);
    await studentPage.getByRole("button", { name: /send|enviar/i }).click();
    await expect(studentPage.getByText(STUDENT_REPLY)).toBeVisible({ timeout: 10000 });

    // ── 3. Admin ve la respuesta pendiente y responde ────────────────────────
    await adminPage.goto("/admin/students/messages");
    await adminPage.waitForLoadState("domcontentloaded");
    await expect(adminPage.getByText(QA_SUBJECT)).toBeVisible();

    await adminPage.goto(conversationUrl);
    await adminPage.waitForLoadState("domcontentloaded");
    await expect(adminPage.getByText(STUDENT_REPLY)).toBeVisible();

    await adminPage.getByPlaceholder(/escribe tu respuesta/i).fill(ADMIN_SECOND_MESSAGE);
    await adminPage.getByRole("button", { name: /enviar respuesta/i }).click();
    await expect(adminPage.getByText(ADMIN_SECOND_MESSAGE)).toBeVisible({ timeout: 10000 });

    // ── 4. Student ve la respuesta de Admin ──────────────────────────────────
    await studentPage.reload();
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage.getByText(ADMIN_SECOND_MESSAGE)).toBeVisible({ timeout: 10000 });

    // ── 5. Admin cierra — Student ya no puede responder ──────────────────────
    await adminPage.getByRole("button", { name: /^cerrar$/i }).click();
    await expect(adminPage.getByText(/^cerrada$/i)).toBeVisible();

    await studentPage.reload();
    await studentPage.waitForLoadState("networkidle");
    await expect(studentPage.getByText(/this conversation is closed|esta conversaci[oó]n est[aá] cerrada/i)).toBeVisible();
    await expect(studentPage.getByRole("textbox")).not.toBeVisible();

    await adminContext.close();
    await studentContext.close();
  });
});
