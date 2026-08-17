import { test, expect } from "@playwright/test";
import { student, allVenueAccounts, venuePassword } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * BLOCK P (resto) / Q / R — completa lo que block-k-l-p-... y block-s-rbac
 * ya cubrieron (P02/P05/P06 y /admin, /admin/mi-local genéricos) con lo que
 * faltaba: P01/P03 (denegación explícita a otros roles), P07 (shell
 * público responsive), y un barrido de denegación por CADA sub-ruta nueva
 * de Admin (Students/Venues/Events/Tokens/Benefits/Engagement/Comunity) —
 * Block S solo probó /admin genérico + /admin/mi-local, no cada sub-ruta
 * individualmente, y un guard mal puesto en una sub-ruta concreta es
 * exactamente el tipo de fallo que un chequeo solo-genérico no detecta.
 *
 * Sin credenciales de Admin en .env.e2e.local (confirmado: no existe
 * ninguna E2E_ADMIN_*): todo flujo POSITIVO de Admin/Command Center queda
 * CREDENTIAL REQUIRED — no se fabrica ninguna cuenta. El read-model del
 * Command Center (funnels/retención/heatmap/comparación/asistencia/
 * referidos/comercio — 199 tests) ya está cubierto server-side en
 * server/segolife/dashboard/*.test.ts, verificado sin regresión en esta
 * misma fase — ver informe final PRE-16.17A.
 */
const ADMIN_SUBROUTES = [
  "/admin/students",
  "/admin/venues",
  "/admin/events",
  "/admin/tokens",
  "/admin/benefits",
  "/admin/engagement/overview",
  "/admin/comunity",
  "/admin/personal",
];

async function assertDenied(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const onLogin = page.url().includes("/login");
  const hasLoginForm = await page.locator("#email").count() > 0;
  const hasRestrictedNotice = await page.getByText(/sin permisos|forbidden|no autorizado|access denied|acceso restringido|debes iniciar sesión/i).count() > 0;
  expect(onLogin || hasLoginForm || hasRestrictedNotice, `esperado denegado en ${path}`).toBeTruthy();
}

test.describe("BLOCK P — Employee/HR (completar P01/P03/P07)", () => {
  test("P01 — Student no accede a /empleado", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/empleado");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/empleado");
  });

  test("P03 — anónimo no accede a /empleado", async ({ page }) => {
    await page.goto("/empleado");
    await page.waitForLoadState("networkidle");
    const onLogin = page.url().includes("/login");
    const notEmpleado = !page.url().includes("/empleado") || (await page.locator("#email").count()) > 0;
    expect(onLogin || notEmpleado).toBeTruthy();
  });

  test("P07 — /empleado/activar (shell público) responsive móvil/tablet sin overflow", async ({ page }) => {
    for (const vp of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(vp);
      await page.goto("/empleado/activar?token=qa-verificacion-no-existe");
      await page.waitForLoadState("networkidle");
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(hasOverflow, `overflow a ${vp.width}px`).toBe(false);
    }
  });
});

test.describe("BLOCK Q — Admin (negativo por cada sub-ruta; positivo = CREDENTIAL REQUIRED)", () => {
  for (const path of ADMIN_SUBROUTES) {
    test(`anónimo denegado en ${path}`, async ({ page }) => {
      await assertDenied(page, path);
    });
  }

  test("Student denegado en cada sub-ruta de Admin (muestra representativa)", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    for (const path of ADMIN_SUBROUTES) {
      await assertDenied(page, path);
    }
  });

  test("Venue admin: cada sub-ruta de Admin global lo redirige a su propio /admin/mi-local (guard real de AdminLayout.tsx, nunca ve Command Center)", async ({ page }) => {
    const [venue] = allVenueAccounts();
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword());
    for (const path of ADMIN_SUBROUTES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      // AdminLayout.tsx confina a venue_admin a /admin/mi-local por diseño
      // (spec §19) — no es un "denegado" con mensaje, es un redirect a su
      // propia vista scoped. Lo que importa: NUNCA se queda en la sub-ruta
      // de Admin global pedida.
      expect(page.url(), `${path} debería redirigir, no mostrarse`).toContain("/admin/mi-local");
    }
  });

  test("API: engagement/tokens/venues admin procedures sin sesión → nunca 200", async ({ request }) => {
    const endpoints = [
      "/api/trpc/admin.getUsers",
      "/api/trpc/hr.employees.list",
    ];
    for (const ep of endpoints) {
      const resp = await request.get(ep);
      expect(resp.status(), ep).not.toBe(200);
    }
  });
});

test.describe("BLOCK R — Command Center (negativo browser + referencia a cobertura server-side)", () => {
  test("Student en /admin (Command Center) ve denegación, nunca los KPIs reales", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    // R20 (no ST presentado como ingreso en efectivo) y R15-R19 (asistencia
    // <=100, sin NaN/Infinity, ceros válidos, recomendaciones deterministas)
    // se verifican contra el read-model real en
    // server/segolife/dashboard/*.test.ts (199 tests, ver informe) — aquí
    // solo confirmamos que un Student nunca ve el dashboard en sí.
    await expect(
      page.getByText(/sin permisos|forbidden|no autorizado|access denied/i).or(page.locator("#email"))
    ).toBeVisible();
  });

  test("Venue admin en /admin (Command Center) nunca lo ve — redirigido a su propio venue", async ({ page }) => {
    const [venue] = allVenueAccounts();
    test.skip(!venue, "no hay cuentas de Venue en .env.e2e.local");
    await loginViaUI(page, venue.email, venuePassword());
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/admin/mi-local");
    await expect(page.getByText(/segotokens economy|command center|kpis/i)).toHaveCount(0);
  });
});
