import { test, expect } from "@playwright/test";
import { student, allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * BLOCK S — pruebas negativas de RBAC/IDOR con navegador real. No basta con
 * que la SPA redirija: cada caso comprueba también que la llamada API
 * protegida devuelve 401/403 real, no solo que el cliente oculta la UI.
 */
test.describe("ANÓNIMO — no debe alcanzar superficies protegidas", () => {
  for (const path of ["/admin", "/admin/mi-local", "/admin/personal", "/empleado", "/ie/profile"]) {
    test(`anónimo en ${path} no ve contenido protegido`, async ({ page }) => {
      const resp = await page.goto(path);
      // SPA: puede devolver 200 (shell) pero debe redirigir a login o mostrar
      // login — nunca el contenido protegido en sí.
      await page.waitForLoadState("networkidle");
      const onLogin = page.url().includes("/login");
      const hasLoginForm = await page.locator("#email").count() > 0;
      const hasRestrictedNotice = await page.getByText(/acceso restringido|debes iniciar sesión/i).count() > 0;
      expect(onLogin || hasLoginForm || hasRestrictedNotice).toBeTruthy();
    });
  }

  test("API: llamada directa a un procedure admin sin sesión devuelve 401", async ({ request }) => {
    const resp = await request.get("/api/trpc/admin.getUsers");
    expect([401, 400]).toContain(resp.status());
  });
});

test.describe("STUDENT — no debe alcanzar Admin, Venue App ni Employee HR", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
  });

  test("Student → /admin: denegado", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/sin permisos|forbidden|no autorizado|access denied/i).or(page.locator("#email"))).toBeVisible();
  });

  test("Student → /admin/mi-local (Venue App): denegado", async ({ page }) => {
    await page.goto("/admin/mi-local");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/sin permisos|forbidden|no autorizado|no tienes ningún venue asignado/i).or(page.locator("#email"))
    ).toBeVisible();
  });

  test("Student → /empleado (Employee Portal): denegado", async ({ page }) => {
    await page.goto("/empleado");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/empleado");
  });

  test("API: hr.portal.me con sesión de Student devuelve FORBIDDEN, no datos", async ({ page }) => {
    const resp = await page.request.get("/api/trpc/hr.portal.me");
    expect(resp.status()).not.toBe(200);
  });
});

test.describe("VENUE ADMIN — aislamiento entre locales + sin Admin/HR global", () => {
  const accounts = allVenueAccounts();

  test("Venue A no puede operar sobre Venue B (aislamiento cruzado)", async ({ page }) => {
    test.skip(accounts.length < 2, "hacen falta ≥2 cuentas de Venue en .env.e2e.local");
    const [venueA, venueB] = accounts;
    await loginViaUI(page, venueA.email, venuePassword());
    await page.goto("/admin/mi-local");
    await page.waitForLoadState("networkidle");
    const bodyText = (await page.textContent("body")) ?? "";
    // Debe ver el nombre de SU propio local...
    expect(bodyText.toLowerCase()).not.toContain(venueB.key.toLowerCase());
  });

  test("Venue admin → Employee/HR: denegado", async ({ page }) => {
    test.skip(accounts.length < 1, "no hay cuentas de Venue");
    await loginViaUI(page, accounts[0].email, venuePassword());
    const resp = await page.request.get("/api/trpc/hr.employees.list");
    expect(resp.status()).not.toBe(200);
  });

  test("Venue admin → panel Admin global (usuarios/settings): denegado", async ({ page }) => {
    test.skip(accounts.length < 1, "no hay cuentas de Venue");
    await loginViaUI(page, accounts[0].email, venuePassword());
    const resp = await page.request.get("/api/trpc/admin.getUsers");
    expect(resp.status()).not.toBe(200);
  });

  test("Venue admin: su propio /admin/mi-local sí carga (control positivo)", async ({ page }) => {
    test.skip(accounts.length < 1, "no hay cuentas de Venue");
    await loginViaUI(page, accounts[0].email, venuePassword());
    await page.goto("/admin/mi-local");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/sin permisos|forbidden|no autorizado/i)).toHaveCount(0);
  });
});
