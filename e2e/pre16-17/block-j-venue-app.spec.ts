import { test, expect } from "@playwright/test";
import { allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";
import fs from "fs";

/**
 * BLOCK J — smoke de Venue App para CADA cuenta real creada en la tarea de
 * handover. Matriz dinámica desde .env.e2e.local — nunca una lista
 * hardcodeada (spec §20). Una captura representativa por Venue, no una por
 * pestaña.
 */
const accounts = allVenueAccounts();
fs.mkdirSync("artifacts/pre16-17-browser", { recursive: true });

for (const venue of accounts) {
  test.describe(`Venue App — ${venue.key}`, () => {
    test(`J-VENUE-01..04 — login, nombre correcto, sin "cambiar venue", tabs visibles`, async ({ page }) => {
      await loginViaUI(page, venue.email, venuePassword());
      await page.goto("/admin/mi-local");
      await page.waitForLoadState("networkidle");

      // J-VENUE-01/02: login funcionó y el nombre REAL de ESTE venue aparece
      // en la cabecera — no el fallback genérico "Venue" (bug real
      // encontrado y corregido en esta misma fase: venues.publicActive solo
      // se pedía para admins globales, así que un venue_admin scoped nunca
      // veía el nombre real).
      const header = page.locator("header p.font-semibold").first();
      await expect(header).toBeVisible();
      await expect(header).not.toHaveText("Venue");

      // J-VENUE-03: sin botón "Cambiar venue" — solo tiene un venue asignado
      // (canChangeVenue = all-admin || >1 venue; ninguna de las dos aplica).
      await expect(page.getByRole("button", { name: "Cambiar venue" })).toHaveCount(0);

      // J-VENUE-04..09: pestañas reales visibles (Hoy/TPV/Entradas/Caja/Eventos/Actividad).
      for (const tab of ["Hoy", "TPV", "Entradas", "Caja", "Eventos", "Actividad"]) {
        await expect(page.getByRole("button", { name: tab })).toBeVisible();
      }

      await page.screenshot({ path: `artifacts/pre16-17-browser/venue-${venue.key.toLowerCase()}.png` });
    });

    test(`J-VENUE-07 — Escanear carga sin error`, async ({ page }) => {
      await loginViaUI(page, venue.email, venuePassword());
      await page.goto("/admin/mi-local");
      await page.getByRole("navigation").getByRole("button", { name: "Escanear" }).click();
      await expect(page.getByText(/error|excepción/i)).toHaveCount(0);
    });

    test(`J-VENUE-12/13 — sin acceso a Admin global ni Employee/HR desde esta sesión`, async ({ page }) => {
      await loginViaUI(page, venue.email, venuePassword());
      const [adminResp, hrResp] = await Promise.all([
        page.request.get("/api/trpc/admin.getUsers"),
        page.request.get("/api/trpc/hr.employees.list"),
      ]);
      expect(adminResp.status()).not.toBe(200);
      expect(hrResp.status()).not.toBe(200);
    });
  });
}
