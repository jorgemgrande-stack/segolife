import { test, expect, type Page } from "@playwright/test";

/**
 * Fase 6 — flujos autenticados: Home → Rewards → Benefits (flujo B del spec)
 * y Scan → fallback manual (flujo C). Reutiliza las MISMAS credenciales que
 * e2e/auth.spec.ts (única cuenta de prueba ya establecida en este repo para
 * e2e — el backend crea perfil de estudiante de forma perezosa para
 * cualquier usuario autenticado, ver server/routers/students.ts,
 * ensureStudentProfile). NUNCA se realiza un canje real de QR — solo se
 * comprueba que el fallback manual aparece al pulsarlo, sin enviar ningún
 * token contra el backend.
 */
const TEST_EMAIL = "admin@nayadeexperiences.es";
const TEST_PASSWORD = "Nayade26*";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/admin/, { timeout: 10000 });
}

test.describe("Segolife — Home/Rewards/Benefits autenticado", () => {
  test("con sesión, /ie muestra la Home real de Segolife (nunca redirige a login)", async ({ page }) => {
    await login(page);
    await page.goto("/ie");
    await expect(page).not.toHaveURL(/\/login/);
    // Saludo + saldo de SegoTokens — contenido real de home.getSummary, nunca texto de ejemplo.
    await expect(page.getByText(/segotokens/i).first()).toBeVisible({ timeout: 8000 });
  });

  test("Rewards separa Spend SegoTokens y My Benefits en pestañas distintas", async ({ page }) => {
    await login(page);
    await page.goto("/ie/rewards");
    await expect(page.getByRole("tab", { name: /spend segotokens|gastar segotokens/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("tab", { name: /my benefits|mis beneficios/i })).toBeVisible({ timeout: 8000 });
  });

  test("/ie/benefits (ruta heredada de Fase 4) abre Rewards con la pestaña de Beneficios activa", async ({ page }) => {
    await login(page);
    await page.goto("/ie/benefits");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("tab", { name: /my benefits|mis beneficios/i, selected: true })).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Segolife — Scan con sesión (sin canje real)", () => {
  test("la pantalla de escaneo carga en estado 'ready' con el fallback manual disponible", async ({ page }) => {
    await login(page);
    await page.goto("/ie/scan");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /scan with camera|escanear con c[aá]mara/i })).toBeVisible({ timeout: 8000 });
    // Fallback manual: pulsar el botón revela el input, sin enviar ningún token.
    await page.getByRole("button", { name: /enter code manually|introducir c[oó]digo manualmente/i }).click();
    await expect(page.getByPlaceholder(/paste or type the code|pega o escribe el c[oó]digo/i)).toBeVisible({ timeout: 3000 });
  });
});
