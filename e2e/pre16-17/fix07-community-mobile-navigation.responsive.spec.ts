import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * FIX-07 — Community en la navegación, contra producción real
 * (playwright.production.config.ts, mismo criterio que el resto de la
 * suite pre16-17). Bug real: `SegolifeBottomNav.tsx` (mobile Y tablet,
 * <1200px) nunca incluyó Community en su array de items, aunque
 * `SegolifeSidebar.tsx` (desktop, >=1200px) ya lo tenía — la ruta en sí
 * nunca estuvo rota, solo faltaba el punto de entrada. Todo lo que sigue
 * es navegación pura, sin mutación económica — seguro contra producción.
 */
function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
}

// El banner de cookies (CookieBanner.tsx) es un card fixed/bottom-0/max-w-md
// centrado, exactamente igual que el bottom nav debajo — mientras no se
// descarta, su `pointer-events-auto` intercepta el tap de CUALQUIER item del
// nav (no solo Comunity: mismo comportamiento pre-existente, confirmado al
// reproducir sin este dismiss — no es una regresión de este fix). Mismo
// patrón que el resto de la suite (fix03/final-admin-qa).
async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

test.describe("FIX-07 — Student con bottom nav (mobile/tablet): Community visible y accesible en 1 toque", () => {
  test("Community aparece en el bottom nav, marca active state, Propose/Your ideas cargan, y volver a Home deja la navegación estable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "Desktop usa el sidebar fijo — cubierto por el describe de abajo");

    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const bottomNav = page.locator("nav.segolife-safe-bottom");
    await expect(bottomNav).toBeVisible();

    const communityLink = bottomNav.getByRole("link", { name: /comunity|comunidad/i });
    await expect(communityLink).toBeVisible();
    await expect(communityLink).not.toHaveAttribute("aria-current", "page");

    await communityLink.click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`/${student.community}/comunity$`));
    await expect(communityLink).toHaveAttribute("aria-current", "page");

    // Contenido real de Community carga (no solo la navegación).
    await expect(page.getByRole("tab", { name: /propose|proponer/i })).toBeVisible({ timeout: 15000 });
    await page.getByRole("tab", { name: /propose|proponer/i }).click();
    await expect(page.getByText(/your ideas|tus ideas/i)).toBeVisible({ timeout: 15000 });

    expect(await hasHorizontalOverflow(page), "overflow horizontal en Community con 6 items en el bottom nav").toBe(false);

    // Volver a Home — la navegación sigue estable, Home se marca activo y Community deja de estarlo.
    const homeLink = bottomNav.getByRole("link", { name: /home|inicio/i });
    await homeLink.click();
    await page.waitForLoadState("networkidle");
    await expect(homeLink).toHaveAttribute("aria-current", "page");
    await expect(communityLink).not.toHaveAttribute("aria-current", "page");

    const relevantErrors = consoleErrors.filter((e) => !/google|gtag|analytics|extension:\/\/|failed to fetch/i.test(e));
    expect(relevantErrors, `console.error inesperado: ${relevantErrors.join(" | ")}`).toEqual([]);
  });

  test("deep link directo a /:slug/comunity ya funcionaba antes del fix — sigue funcionando, y ahora también marca active state en el bottom nav", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "Cubierto por el smoke de desktop de abajo");

    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);
    await page.goto(`/${student.community}/comunity`);
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(new RegExp(`/${student.community}/comunity$`));
    await expect(page.getByRole("tab", { name: /propose|proponer/i })).toBeVisible({ timeout: 15000 });

    const communityLink = page.locator("nav.segolife-safe-bottom").getByRole("link", { name: /comunity|comunidad/i });
    await expect(communityLink).toHaveAttribute("aria-current", "page");
  });

  test("un Student solo-IE que visita /uva/comunity no ve contenido de UVA (guard de pertenencia existente, sin tocar)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "El guard es agnóstico de viewport — una comprobación basta");

    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);
    await page.goto("/uva/comunity");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/\/uva\//);
  });
});

test.describe("FIX-07 — Desktop smoke: Community en el sidebar, sin regresión", () => {
  test("Comunity sigue presente y funcional en el sidebar fijo", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Solo aplica al proyecto desktop (sidebar fijo, >=1200px)");

    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    const communityLink = sidebar.getByRole("link", { name: /comunity|comunidad/i });
    await expect(communityLink).toBeVisible();

    await communityLink.click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`/${student.community}/comunity$`));
    await expect(communityLink).toHaveAttribute("aria-current", "page");
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
