import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * FIX-05A — Event Lifecycle Normalization + Ended Events, contra
 * producción real (playwright.production.config.ts únicamente, mismo
 * criterio que fix04-fourvenues-lifecycle).
 *
 * Casos reales usados:
 * - event 118 "PRE OPENING X HOUSEMAF" (slug pre-opening-x-housemaf),
 *   Casanova, finalizado hace ~5 días (14/08/2026), asignado a IE+UVA —
 *   confirmado en producción como el evento MÁS RECIENTE del ranking DESC
 *   de Ended Events real para este venue (verificado por lectura directa
 *   antes de este spec: event 119 "WELCOME BACK BASH", usado en los tests
 *   unitarios de FIX-04/05A, es en realidad el evento MÁS ANTIGUO de los
 *   88 reales — rank 88/88 — y nunca aparecería dentro de un límite de
 *   página razonable de 8-24; se usa aquí un evento que SÍ es alcanzable
 *   con los límites reales de la UI, evitando un falso negativo).
 * - pre-opening-x-fcking-wednesdays — borrador real de Fourvenues,
 *   confirmado en FIX-04 — NUNCA debe aparecer en Ended Events (es
 *   futuro, no finalizado, y además un borrador).
 *
 * Admin (/admin/events) requiere credenciales que no existen en
 * .env.e2e.local — CREDENTIAL REQUIRED, cubierto en su lugar por
 * EventsManager.test.tsx (eventStatusBadge/eventOriginCaption).
 *
 * /uva/explore — igualmente CREDENTIAL REQUIRED: .env.e2e.local solo define
 * una cuenta `student` (E2E_STUDENT_COMMUNITY=ie), sin ninguna cuenta UVA.
 * Un Student autenticado que navega a la URL de otra comunidad de la que no
 * es miembro real es redirigido a su propia comunidad por un guard previo y
 * ya documentado (SegolifeAppShell.tsx, "Bug real reportado con capturas" —
 * anterior a FIX-05A) — comportamiento correcto, no un bug de Ended Events.
 * El primer intento de este spec probó `/uva/explore` con la cuenta IE-only
 * y falló por timeout esperando el chip "Ended Events", que nunca llega a
 * renderizarse porque la página redirige antes a /ie. El aislamiento por
 * comunidad de Ended Events (IE-only, UVA-rechazado, IE+UVA-ambos) ya está
 * cubierto a nivel unitario en server/db/eventsDb.test.ts
 * ("listEndedEvents — FIX-05A", 12 tests, incluye los 3 casos de scoping).
 */

const ENDED_EVENT_NAME = "PRE OPENING X HOUSEMAF";
const ENDED_EVENT_SLUG = "pre-opening-x-housemaf";
const DRAFT_EVENT_NAME = "PRE OPENING X FCKING WEDNESDAYS";

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

test.describe("FIX-05A — Explore: filtro Ended Events (spec §6/§8)", () => {
  test("/ie/explore — Ended Events muestra el histórico real (event 118, IE+UVA), nunca un borrador futuro", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/ie/explore");
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await page.getByText(/ended events|eventos finalizados/i).click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(ENDED_EVENT_NAME, { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(DRAFT_EVENT_NAME, { exact: false })).not.toBeVisible();
  });
});

test.describe("FIX-05A — Venue Detail: Ended Events community/venue-scoped (spec §7/§9)", () => {
  test("/ie/venues/casanova — sección Ended events debajo de Upcoming, con el histórico real, sin CTA de compra", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/ie/venues/casanova");
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const endedHeading = page.getByText(/^(ended events|eventos finalizados)$/i);
    await expect(endedHeading).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(ENDED_EVENT_NAME, { exact: false })).toBeVisible();
    // El tratamiento visual atenuado (opacity-60) ya está probado en
    // VenueDetail.test.tsx — aquí solo importa que el dato real llegue.
  });
});

test.describe("FIX-05A — Event Detail: badge Ended, nunca CTA de compra (spec §11)", () => {
  test(`/ie/events/${ENDED_EVENT_SLUG} — muestra 'Ended'/'Finalizado', nunca 'Comprar ahora' ni un CTA activo`, async ({ page }) => {
    await page.goto(`/ie/events/${ENDED_EVENT_SLUG}`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await expect(page.getByText(/^(ended|finalizado)$/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/comprar ahora|buy now/i)).not.toBeVisible();
    // El botón de compra deshabilitado (si existe) debe decir "ya ha terminado", nunca ofrecer una acción real.
    const disabledCta = page.getByRole("button", { name: /already ended|ya ha terminado/i });
    if (await disabledCta.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(disabledCta).toBeDisabled();
    }
  });
});
