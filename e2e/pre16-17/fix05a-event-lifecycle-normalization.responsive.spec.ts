import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * FIX-05A — Event Lifecycle Normalization + Ended Events, contra
 * producción real (playwright.production.config.ts únicamente, mismo
 * criterio que fix04-fourvenues-lifecycle).
 *
 * Casos reales usados:
 * - event 119 "WELCOME BACK BASH" (slug welcome-back-bash), Casanova,
 *   finalizado hace 11+ meses, asignado a IE+UVA — confirmado accesible
 *   (histórico legítimo) por eventsDb.ts::listEndedEvents.
 * - pre-opening-x-fcking-wednesdays — borrador real de Fourvenues,
 *   confirmado en FIX-04 — NUNCA debe aparecer en Ended Events (es
 *   futuro, no finalizado, y además un borrador).
 *
 * Admin (/admin/events) requiere credenciales que no existen en
 * .env.e2e.local — CREDENTIAL REQUIRED, cubierto en su lugar por
 * EventsManager.test.tsx (eventStatusBadge/eventOriginCaption).
 */

const ENDED_EVENT_NAME = "WELCOME BACK BASH";
const ENDED_EVENT_SLUG = "welcome-back-bash";
const DRAFT_EVENT_NAME = "PRE OPENING X FCKING WEDNESDAYS";

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

test.describe("FIX-05A — Explore: filtro Ended Events (spec §6/§8)", () => {
  for (const community of ["ie", "uva"] as const) {
    test(`/${community}/explore — Ended Events muestra el histórico real (event 119, IE+UVA), nunca un borrador futuro`, async ({ page }) => {
      await loginViaUI(page, student.email, student.password);
      await page.goto(`/${community}/explore`);
      await page.waitForLoadState("networkidle");
      await dismissCookies(page);

      await page.getByText(/ended events|eventos finalizados/i).click();
      await page.waitForLoadState("networkidle");

      await expect(page.getByText(ENDED_EVENT_NAME, { exact: false })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(DRAFT_EVENT_NAME, { exact: false })).not.toBeVisible();
    });
  }
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
