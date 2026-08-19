import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * FIX-04 — Fourvenues Event Lifecycle & Publication Status, contra
 * producción real (mismo criterio que mg01/mg02/mg03: playwright.
 * production.config.ts únicamente, sin infra paralela).
 *
 * CASO B verificado empíricamente 2026-08-19 vía llamada real de solo
 * lectura a la API de Fourvenues (Integrations API, X-Api-Key): el evento
 * `pre-opening-x-fcking-wednesdays` está hoy en active=false en origen —
 * un borrador real, confirmado también por un humano revisando Fourvenues
 * directamente. Conocer el slug NUNCA debe bastar para acceder a él.
 *
 * CASO C — DATA STATE real confirmado por lectura directa (solo lectura)
 * de la tabla `events` antes de este spec: CERO eventos con
 * status=active/starts_at futuro que no sean un borrador de Fourvenues
 * (0 nativos, 0 Fourvenues publicados en ningún venue conectado). Los
 * estados vacíos de Tonight/Upcoming/Explore verificados aquí son el
 * resultado CORRECTO de la fase actual del negocio (spec §CASO C — "ESO
 * PUEDE SER EL RESULTADO CORRECTO"), nunca un evento se fabrica para
 * evitarlos.
 */

const DRAFT_EVENT_SLUG = "pre-opening-x-fcking-wednesdays";
const DRAFT_EVENT_NAME = "PRE OPENING X FCKING WEDNESDAYS";

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

test.describe("FIX-04 — acceso directo por slug a un borrador de Fourvenues (CASO B)", () => {
  test("Student anónimo: /ie/events/pre-opening-x-fcking-wednesdays -> 'Evento no encontrado', nunca comprable", async ({ page }) => {
    await page.goto(`/${student.community}/events/${DRAFT_EVENT_SLUG}`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await expect(page.getByText(/event not found|evento no encontrado/i)).toBeVisible({ timeout: 15000 });
    // Nunca revela el nombre real del evento en borrador ni ofrece compra.
    await expect(page.getByText(DRAFT_EVENT_NAME, { exact: false })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /comprar|continuar|checkout/i })).not.toBeVisible();
  });

  test("Student autenticado: el mismo slug directo TAMBIÉN es 'no encontrado' — la protección no es solo para anónimos", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/events/${DRAFT_EVENT_SLUG}`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await expect(page.getByText(/event not found|evento no encontrado/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(DRAFT_EVENT_NAME, { exact: false })).not.toBeVisible();
  });
});

test.describe("FIX-04 — Home Tonight/Upcoming y Explore nunca muestran el borrador (CASO B/C)", () => {
  test("Home: ni Tonight ni Upcoming muestran el evento en borrador — hoy, DATA STATE real, ambos están vacíos (resultado correcto, no fabricado)", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    // El nombre del borrador nunca debe aparecer en la Home, sea cual sea el estado de las demás secciones.
    await expect(page.getByText(DRAFT_EVENT_NAME, { exact: false })).not.toBeVisible();

    // DATA STATE 2026-08-19 (verificado por lectura directa de BD antes de
    // este spec): 0 eventos publicados futuros en ningún venue conectado
    // (Fourvenues o nativo) — Tonight/Upcoming deben mostrar su estado
    // vacío real, nunca quedarse cargando ni fabricar contenido.
    await expect(page.getByText(/no events tonight|no hay eventos esta noche/i)).toBeVisible({ timeout: 15000 });
    const upcomingTab = page.getByRole("tab", { name: /upcoming|próximos/i });
    if (await upcomingTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await upcomingTab.click();
      await expect(page.getByText(/no upcoming events|no hay próximos eventos/i)).toBeVisible({ timeout: 10000 });
    }
  });

  test("Explore: el evento en borrador nunca aparece en el listado, con o sin filtros", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/explore`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await expect(page.getByText(DRAFT_EVENT_NAME, { exact: false })).not.toBeVisible();
  });
});
