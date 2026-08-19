import { test, expect, type Page } from "@playwright/test";

/**
 * COMUNITY — smoke E2E (spec punto 90). Cubre que las pantallas reales
 * cargan en un navegador real con sesión, y que ninguna ruta de COMUNITY
 * es accesible sin autenticar (mismo criterio que
 * segolife-community-routing.spec.ts para el resto de rutas privadas).
 * No crea datos de negocio ni realiza ningún voto/publicación real — solo
 * verifica que el shell/routing/rendering funciona de extremo a extremo.
 * Necesita el backend real corriendo (mismo supuesto que el resto de
 * e2e/*.spec.ts).
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

test.describe("COMUNITY — rutas privadas sin sesión", () => {
  test("/admin/comunity sin sesión redirige a login", async ({ page }) => {
    await page.goto("/admin/comunity");
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test("/ie/comunity sin sesión redirige a login", async ({ page }) => {
    await page.goto("/ie/comunity");
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });
});

test.describe("COMUNITY — admin autenticado", () => {
  test("/admin/comunity carga el panel con los cubos visuales y el botón de nueva propuesta", async ({ page }) => {
    await login(page);
    await page.goto("/admin/comunity");
    await expect(page.getByRole("heading", { name: "COMUNITY", level: 2 })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: /nueva propuesta/i })).toBeVisible();
    await expect(page.getByText(/moderación pendiente/i)).toBeVisible();
  });

  test("el wizard de creación (/admin/comunity/nueva) carga el paso 1 real", async ({ page }) => {
    await login(page);
    await page.goto("/admin/comunity/nueva");
    await expect(page.getByText(/paso 1 de 7/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByPlaceholder(/hacemos after party/i)).toBeVisible();
  });

  test("la cola de moderación (/admin/comunity/moderacion) carga", async ({ page }) => {
    await login(page);
    await page.goto("/admin/comunity/moderacion");
    await expect(page.getByRole("heading", { name: /moderación de ideas de estudiante/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe("COMUNITY — estudiante autenticado", () => {
  test("/ie/comunity carga el hub con sus 4 pestañas", async ({ page }) => {
    await login(page);
    await page.goto("/ie/comunity");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("tab", { name: "Activas" })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("tab", { name: "Respondidas" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Resultados" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Proponer" })).toBeVisible();
  });

  test("la pestaña Proponer permite escribir una idea (sin enviarla)", async ({ page }) => {
    await login(page);
    await page.goto("/ie/comunity");
    await page.getByRole("tab", { name: "Proponer" }).click();
    const input = page.getByPlaceholder(/torneo de pádel/i);
    await expect(input).toBeVisible({ timeout: 8000 });
    await input.fill("Idea de prueba E2E — nunca se envía");
    await expect(page.getByRole("button", { name: /enviar idea/i })).toBeEnabled();
  });

  // Community Proposals (backlog) — venue relacionado + fecha sugerida con
  // presets, extensión del formulario Student. Mismo criterio que el test
  // anterior: escribe/interactúa pero NUNCA pulsa "Enviar idea" (spec §29,
  // prohibido fabricar propuestas reales en producción).
  test("la pestaña Proponer ofrece venue relacionado y fecha sugerida con presets — sin enviar nada real", async ({ page }) => {
    await login(page);
    await page.goto("/ie/comunity");
    await page.getByRole("tab", { name: "Proponer" }).click();

    await expect(page.getByText(/local relacionado/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/cuándo te gustaría que fuera/i)).toBeVisible();

    const thisWeekendBtn = page.getByRole("button", { name: /este finde/i });
    await expect(thisWeekendBtn).toBeVisible();
    await thisWeekendBtn.click();

    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

    // NUNCA campos reservados al Admin (comunidad ya viene de la sesión real, nunca un selector propio).
    await expect(page.getByText(/alcance administrativo/i)).not.toBeVisible();
    await expect(page.getByText(/audiencia/i)).not.toBeVisible();
  });
});
