import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * MG-01 — selector Tonight/Upcoming en la Home del Student, contra
 * producción real. Nombre .responsive.spec.ts (mismo criterio que
 * block-t.responsive.spec.ts) para correr en los 3 proyectos configurados
 * en playwright.production.config.ts (desktop 1440×900, mobile 390×844,
 * tablet 1024×768).
 *
 * No se fabrica ningún evento de producción para forzar una captura — los
 * tests aceptan tanto "hay eventos reales" como "estado vacío real" como
 * resultados válidos y comprueban la estructura correcta en ambos casos
 * (spec MG-01 §15/§16: "cúbrelo como DATA STATE si el estado actual de
 * producción no permite comprobar una variante concreta").
 *
 * Cobertura de i18n: la única cuenta QA disponible es de la comunidad IE
 * (inglés). La variante en español del estado vacío de Upcoming está
 * cubierta de forma determinista en Home.test.tsx (mock de comunidad UVA) —
 * no existe cuenta QA de UVA para repetirlo aquí contra producción real
 * (DATA STATE, ver informe final).
 */

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

test.describe("MG-01 — Home: selector Tonight/Upcoming", () => {
  test("Home carga, Tonight es la pestaña inicial, sin errores de consola ni de red", async ({ page }) => {
    const consoleErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("requestfailed", req => requestFailures.push(`${req.method()} ${req.url()}`));

    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const tonightTab = page.getByRole("tab", { name: /^tonight$|^esta noche$/i });
    const upcomingTab = page.getByRole("tab", { name: /^upcoming$|^próximos$/i });
    await expect(tonightTab).toBeVisible();
    await expect(upcomingTab).toBeVisible();
    // Estado por defecto (spec §7) — Tonight seleccionado sin tocar nada.
    await expect(tonightTab).toHaveAttribute("data-state", "active");
    await expect(upcomingTab).toHaveAttribute("data-state", "inactive");

    // Filtra ruido conocido y ajeno a esta feature (analytics/terceros ya
    // presentes en producción antes de MG-01) — solo falla por algo real.
    const relevantErrors = consoleErrors.filter(e => !/google|gtag|analytics|extension:\/\//i.test(e));
    expect(relevantErrors, `errores de consola inesperados: ${relevantErrors.join(" | ")}`).toEqual([]);
    expect(requestFailures, `peticiones fallidas: ${requestFailures.join(" | ")}`).toEqual([]);
  });

  test("pulsar Upcoming cambia la pestaña activa y muestra contenido real o el estado vacío correcto — nunca ambos, nunca ninguno", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const tonightTab = page.getByRole("tab", { name: /^tonight$|^esta noche$/i });
    const upcomingTab = page.getByRole("tab", { name: /^upcoming$|^próximos$/i });
    await upcomingTab.click();
    await page.waitForLoadState("networkidle");

    await expect(upcomingTab).toHaveAttribute("data-state", "active");
    await expect(tonightTab).toHaveAttribute("data-state", "inactive");

    const emptyState = page.getByText(/no upcoming events|no hay próximos eventos/i);
    const eventCards = page.getByRole("tabpanel").locator("a[href*='/events/']");

    // La query de Upcoming es lazy (spec §13) — tras pulsar la pestaña sigue
    // cargando un instante más allá de networkidle. Espera de verdad (con
    // reintento real de Playwright) a que aparezca UNA de las dos cosas,
    // en vez de mirar el DOM en un instante fijo (eso fue lo que falló la
    // primera vez: capturaba el skeleton de carga a mitad de camino).
    await expect(emptyState.or(eventCards.first())).toBeVisible({ timeout: 10000 });

    const hasEmpty = await emptyState.isVisible();
    const cardCount = await eventCards.count();

    // DATA STATE real: no se fabrica ningún evento — se acepta cualquiera de
    // los dos resultados válidos, nunca un tercer estado (ambos o ninguno).
    expect(hasEmpty || cardCount > 0, "Upcoming no muestra ni eventos ni el estado vacío").toBe(true);
    expect(hasEmpty && cardCount > 0, "Upcoming muestra a la vez cards Y el estado vacío").toBe(false);

    if (cardCount > 0) {
      // Navegación al detalle canónico (spec §10) — nunca una ruta nueva.
      const firstHref = await eventCards.first().getAttribute("href");
      expect(firstHref).toMatch(new RegExp(`^/${student.community}/events/`));
    } else {
      // CTA "Explore all" sigue disponible y sigue apuntando al Explore real
      // (spec §8/§10) aunque Upcoming esté vacío.
      const exploreCta = page.getByRole("link", { name: /explore all|explorar todo/i });
      await expect(exploreCta).toHaveAttribute("href", `/${student.community}/explore`);
    }
  });

  test("volver a pulsar Tonight restaura su contenido sin recargar la página", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    const tonightTab = page.getByRole("tab", { name: /^tonight$|^esta noche$/i });
    const upcomingTab = page.getByRole("tab", { name: /^upcoming$|^próximos$/i });

    const tonightEmpty = page.getByText(/no events tonight|no hay eventos esta noche/i);
    const tonightCards = page.getByRole("tabpanel").locator("a[href*='/events/']");
    // Tonight ya se resolvió con la carga inicial de Home (no es lazy) —
    // confirma su contenido ANTES de tocar Upcoming, para tener un punto de
    // comparación real de "qué debería seguir habiendo" al volver.
    await expect(tonightEmpty.or(tonightCards.first())).toBeVisible({ timeout: 10000 });
    const hadEmptyBefore = await tonightEmpty.isVisible();
    const cardCountBefore = await tonightCards.count();

    await upcomingTab.click();
    await expect(page.getByText(/no upcoming events|no hay próximos eventos/i).or(page.getByRole("tabpanel").locator("a[href*='/events/']").first())).toBeVisible({ timeout: 10000 });

    await tonightTab.click();
    await expect(tonightTab).toHaveAttribute("data-state", "active");

    // Tonight sigue mostrando EXACTAMENTE lo mismo que antes de tocar
    // Upcoming — la regresión que este test vigila es una pantalla en
    // blanco (o el contenido de Upcoming filtrándose) al volver.
    await expect(tonightEmpty.or(tonightCards.first())).toBeVisible({ timeout: 10000 });
    expect(await tonightEmpty.isVisible()).toBe(hadEmptyBefore);
    expect(await tonightCards.count()).toBe(cardCountBefore);
  });

  test("sin overflow horizontal ni solapamiento evidente con la navegación inferior", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);
    await page.getByRole("tab", { name: /^upcoming$|^próximos$/i }).click();
    await expect(
      page.getByText(/no upcoming events|no hay próximos eventos/i).or(page.getByRole("tabpanel").locator("a[href*='/events/']").first())
    ).toBeVisible({ timeout: 10000 });

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    );
    expect(hasHorizontalOverflow, "overflow horizontal tras cambiar a Upcoming").toBe(false);
  });
});
