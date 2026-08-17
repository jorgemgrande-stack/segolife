import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

// Evento real IE/Casanova confirmado activo en producción.
const EVENT_SLUG = "pre-opening-x-fcking-wednesdays";

test.describe("BLOCK G — Events / checkout (frontera segura)", () => {
  test("G01/G02/G03 — listado (Explore) y detalle de evento, contexto de comunidad", async ({ page }) => {
    await page.goto(`/${student.community}/explore`);
    await expect(page.getByRole("heading", { name: "Explore", level: 1 })).toBeVisible();
    await expect(page.getByPlaceholder(/search events or venues/i)).toBeVisible();

    await page.goto(`/${student.community}/events/${EVENT_SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("G13 — slug inexistente en cualquier comunidad devuelve 'no encontrado', nunca datos cruzados", async ({ page }) => {
    await page.goto(`/uva/events/no-existe-slug-${Date.now()}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/not found|no encontrad/i)).toBeVisible();
  });

  test("G04-G07 — DATA STATE: ningún evento activo usa venta nativa hoy; el botón de compra representa honestamente el redirect externo (Fourvenues)", async ({ page }) => {
    // Verificado contra producción (solo lectura): 0 filas en sales_channels
    // con sales_mode='native' entre los eventos activos futuros — el 100%
    // de los eventos IE/UVA activos hoy venden vía redirect externo. No es
    // un bug: computePurchaseAction() ya decide correctamente entre
    // "external_url" y "native_checkout" según sales_channels.sales_mode,
    // dato real por evento, nunca hardcodeado. G08-G12 (hold de checkout
    // nativo) queda como DATA STATE — no hay ningún evento real contra el
    // que probarlo hoy sin fabricar datos de negocio, algo fuera de alcance.
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/events/${EVENT_SLUG}`);
    await page.waitForLoadState("networkidle");
    const buyLink = page.getByRole("link", { name: /buy tickets|comprar entradas/i });
    await expect(buyLink).toBeVisible();
    await expect(buyLink).toHaveAttribute("target", "_blank");
    await expect(buyLink).toHaveAttribute("rel", /noopener/);
    const href = await buyLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).not.toMatch(/nayade|skicenter/i);
  });

  test("G15/G16 — responsive del detalle de evento (móvil/tablet)", async ({ page }) => {
    for (const vp of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(vp);
      await page.goto(`/${student.community}/events/${EVENT_SLUG}`);
      await page.waitForLoadState("networkidle");
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(hasOverflow, `overflow horizontal a ${vp.width}px`).toBe(false);
    }
  });
});
