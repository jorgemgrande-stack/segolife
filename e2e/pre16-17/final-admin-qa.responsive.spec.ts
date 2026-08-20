import { test, expect } from "@playwright/test";
import fs from "fs";
import { admin } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * FINAL ZERO-DEBT — Block C. QA visual real de superficies Admin contra
 * producción, con la cuenta Admin QA dedicada (docs/QA_ACCOUNTS.md) —
 * cierra los "CREDENTIAL REQUIRED" acumulados en PRE-16.17/MG-03B/MG-04/
 * FIX-06. .responsive.spec.ts para correr en los 3 proyectos.
 *
 * FIX-06 (C1): Acciones/fechas ya tenían cobertura de componente
 * (EventsManager.actions.test.tsx) — aquí se valida contra producción
 * real. Ocultar/Mostrar se hace un ciclo completo REVERSIBLE sobre un
 * evento real ya existente (nunca se deja alterado). Eliminar NUNCA se
 * confirma contra un evento real — solo se abre y se cancela el diálogo
 * (cobertura de "sí borra de verdad" ya vive en eventsDb.test.ts/
 * events.test.ts, server-side, sin tocar datos reales).
 */

const ARTIFACTS_DIR = "artifacts/final-zero-debt-qa";
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function dismissCookies(page: import("@playwright/test").Page) {
  // locator.isVisible() no reintenta — es una comprobación puntual, no una
  // espera real (a diferencia de otros specs de esta sesión que llamaban a
  // esto justo tras networkidle, donde el banner ya llevaba tiempo montado,
  // aquí se usa domcontentloaded — más rápido pero el banner de cookies
  // (montado por un efecto de cliente con su propio retraso) puede no
  // existir todavía en el DOM). waitFor({state:"visible"}) sí reintenta de
  // verdad durante el timeout — real fix, no solo un sleep más largo.
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  await btn.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
}

const SURFACES: { name: string; path: string; expectText: RegExp }[] = [
  { name: "command-center", path: "/admin", expectText: /community pulse|student intelligence|segolife live/i },
  { name: "events", path: "/admin/events", expectText: /eventos|acciones/i },
  { name: "community-moderation", path: "/admin/comunity/moderacion", expectText: /moderación de ideas/i },
  { name: "communication-center", path: "/admin/engagement/overview", expectText: /engagement|comunicaci|campañ/i },
  { name: "employee-hr", path: "/admin/personal", expectText: /rrhh|personal|empleados/i },
  { name: "venues", path: "/admin/venues", expectText: /venues|locales/i },
];

test.describe("FINAL ZERO-DEBT — Admin positive RBAC + responsive (Block C)", () => {
  for (const surface of SURFACES) {
    test(`${surface.name}: accesible, sin error de autorización, sin overflow`, async ({ page }, testInfo) => {
      const consoleErrors: string[] = [];
      page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

      await loginViaUI(page, admin.email, admin.password);
      await page.goto(surface.path);
      await page.waitForLoadState("domcontentloaded");
      await dismissCookies(page);

      // Nunca un error de autorización — esta cuenta debe tener acceso real.
      await expect(page.getByText(/no autorizado|forbidden|acceso denegado|401|403/i)).not.toBeVisible();
      await expect(page.getByText(surface.expectText).first()).toBeVisible({ timeout: 15000 });

      const hasOverflow = await hasHorizontalOverflow(page);
      expect(hasOverflow, `overflow horizontal en ${surface.path}`).toBe(false);

      await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-${surface.name}.png`, fullPage: false });

      const relevantErrors = consoleErrors.filter(e => !/google|gtag|analytics|extension:\/\/|failed to fetch/i.test(e));
      expect(relevantErrors, `console.error en ${surface.path}: ${relevantErrors.join(" | ")}`).toEqual([]);
    });
  }
});

test.describe("FINAL ZERO-DEBT — FIX-06 visual QA contra producción real (Block C1)", () => {
  test("columna Acciones, badges, filtro de fechas, ciclo Ocultar/Mostrar reversible, diálogo Eliminar (nunca confirmado)", async ({ page }, testInfo) => {
    await loginViaUI(page, admin.email, admin.password);
    await page.goto("/admin/events");
    await page.waitForLoadState("domcontentloaded");
    await dismissCookies(page);

    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    const rowName = (await firstRow.locator("a[href^='/admin/events/']").first().innerText()).trim();

    // A — Acciones visibles en la primera fila.
    await expect(firstRow.getByRole("link", { name: new RegExp(`editar ${rowName}`, "i") })).toBeVisible();
    const hideBtn = firstRow.getByRole("button", { name: new RegExp(`(ocultar|mostrar) ${rowName}`, "i") });
    await expect(hideBtn).toBeVisible();
    await expect(firstRow.getByRole("button", { name: new RegExp(`eliminar ${rowName}`, "i") })).toBeVisible();

    // B — ciclo Ocultar → Mostrar, reversible, sobre un evento real.
    const wasHidden = (await hideBtn.getAttribute("title"))?.toLowerCase().includes("mostrar");
    await hideBtn.click();
    await page.waitForTimeout(600);
    if (!wasHidden) {
      await expect(firstRow.getByText("Oculto")).toBeVisible({ timeout: 5000 });
    } else {
      await expect(firstRow.getByText("Oculto")).not.toBeVisible({ timeout: 5000 });
    }
    // revertir SIEMPRE, deje como deje el evento exactamente como estaba.
    await firstRow.getByRole("button", { name: new RegExp(`(ocultar|mostrar) ${rowName}`, "i") }).click();
    await page.waitForTimeout(600);
    if (wasHidden) {
      await expect(firstRow.getByText("Oculto")).toBeVisible({ timeout: 5000 });
    } else {
      await expect(firstRow.getByText("Oculto")).not.toBeVisible({ timeout: 5000 });
    }

    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-events-actions.png`, fullPage: false });

    // C — filtro de fechas: rango real que incluye eventos de marzo 2026 (verificado por smoke test de producción).
    await page.locator("#events-filter-from").fill("2026-03-01");
    await page.locator("#events-filter-to").fill("2026-03-31");
    // filtro AJAX (misma tRPC query, sin navegación) — esperar el recuento actualizado, nunca una carga de página completa.
    await expect(page.getByText(/evento\(s\)/i)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-events-date-filter.png`, fullPage: false });

    // D — rango inválido muestra validación clara.
    await page.locator("#events-filter-from").fill("2026-03-31");
    await page.locator("#events-filter-to").fill("2026-03-01");
    await expect(page.getByText(/no puede ser posterior/i)).toBeVisible();

    // E — Limpiar fechas.
    await page.getByText(/limpiar fechas/i).click();
    await expect(page.locator("#events-filter-from")).toHaveValue("");
    await expect(page.locator("#events-filter-to")).toHaveValue("");

    // F — Eliminar: se abre y se CANCELA, nunca se confirma contra un evento real.
    await firstRow.getByRole("button", { name: new RegExp(`eliminar ${rowName}`, "i") }).click();
    await expect(page.getByText(/¿eliminar este evento\?/i)).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-events-delete-dialog.png`, fullPage: false });
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByText(/¿eliminar este evento\?/i)).not.toBeVisible();
  });
});
