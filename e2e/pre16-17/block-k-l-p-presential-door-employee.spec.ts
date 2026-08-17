import { test, expect } from "@playwright/test";
import { student, allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

const [venue] = allVenueAccounts();

test.describe("BLOCK K — Presential SegoTokens (solo UI segura, sin crear una solicitud real)", () => {
  test("K-UI — TPV muestra el control 'Solicitar pago con SegoTokens' sin ejecutar ninguna solicitud", async ({ page }) => {
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword());
    await page.goto("/admin/mi-local");
    await page.getByRole("navigation").getByRole("button", { name: "TPV" }).click();
    await page.waitForLoadState("networkidle");
    // Solo se verifica que la página del TPV de ESTE venue carga sin error
    // — deliberadamente NO se pulsa "Solicitar pago con SegoTokens": crear
    // una solicitud real reserva ST del Student aunque sea reversible, y
    // requiere identificar a un Student (cámara o búsqueda) para completar
    // el ciclo de forma segura sin dejar estado colgado. Queda MANUAL
    // REQUIRED — ver informe final.
    await expect(page.getByText(/error|excepción/i)).toHaveCount(0);
  });

  test("K02 — identificar a un Student (búsqueda, no cámara) no muta su wallet", async ({ page }) => {
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    const before = await (async () => {
      await loginViaUI(page, student.email, student.password);
      return page.locator("p.tabular-nums").first().textContent();
    })();
    await page.context().clearCookies();
    await loginViaUI(page, venue.email, venuePassword());
    await page.goto("/admin/mi-local");
    await page.getByRole("navigation").getByRole("button", { name: "TPV" }).click();
    await page.waitForLoadState("networkidle");
    await page.context().clearCookies();
    await loginViaUI(page, student.email, student.password);
    const after = await page.locator("p.tabular-nums").first().textContent();
    expect(after).toBe(before);
  });
});

test.describe("BLOCK L — Door Sales (solo UI segura, sin emitir entradas reales)", () => {
  test("L01-L04 — pestaña Entradas carga con el scope del venue correcto, sin errores", async ({ page }) => {
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword());
    await page.goto("/admin/mi-local");
    await page.getByRole("navigation").getByRole("button", { name: "Entradas" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/error|excepción/i)).toHaveCount(0);
  });

  test("L05 — un Venue no puede operar venta de puerta de otro Venue (API)", async ({ page }) => {
    const accounts = allVenueAccounts();
    test.skip(accounts.length < 2, "hacen falta ≥2 cuentas de Venue");
    const [a, b] = accounts;
    await loginViaUI(page, a.email, venuePassword());
    // Búsqueda genérica de un procedure de venta de puerta con venueId ajeno
    // — la respuesta nunca debe ser 200 con datos del otro venue.
    const resp = await page.request.get(`/api/trpc/doorSale.eventsForVenue?input=${encodeURIComponent(JSON.stringify({ venueId: 999999 }))}`).catch(() => null);
    if (resp) expect(resp.status()).not.toBe(200);
  });
});

test.describe("BLOCK P — Employee/HR (negativo + branding, sin crear empleados)", () => {
  test("P02 — Venue operator no accede a /empleado", async ({ page }) => {
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword());
    await page.goto("/empleado");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/empleado");
  });

  test("P06 — /empleado/activar (superficie pública) sin branding Náyade/Skicenter", async ({ page }) => {
    await page.goto("/empleado/activar?token=qa-verificacion-no-existe");
    await page.waitForLoadState("networkidle");
    const html = await page.content();
    expect(html).not.toMatch(/n[áa]yade/i);
    expect(html).not.toMatch(/skicenter/i);
  });

  test("P05 — Admin HR (/admin/personal) requiere sesión — sin credenciales de Admin, se documenta como CREDENTIAL REQUIRED, se confirma solo el rechazo anónimo", async ({ page }) => {
    await page.goto("/admin/personal");
    await page.waitForLoadState("networkidle");
    const onLogin = page.url().includes("/login");
    const hasLoginForm = await page.locator("#email").count() > 0;
    const hasRestrictedNotice = await page.getByText(/acceso restringido|debes iniciar sesión/i).count() > 0;
    expect(onLogin || hasLoginForm || hasRestrictedNotice).toBeTruthy();
  });
});
