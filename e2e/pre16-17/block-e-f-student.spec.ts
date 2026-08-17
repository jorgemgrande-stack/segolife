import { test, expect, Page } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/** IE tiene defaultLocale="en" — la cuenta QA registrada en IE ve la interfaz
 * en inglés por diseño (confirmado real esta fase, no un bug). Todos los
 * locators de este archivo son bilingües a propósito por eso, no por pereza. */
async function dismissCookieBanner(page: Page) {
  const accept = page.getByRole("button", { name: /accept all|aceptar todo/i });
  if (await accept.isVisible({ timeout: 3000 }).catch(() => false)) await accept.click();
}

test.describe("BLOCK E — Student App autenticada", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await dismissCookieBanner(page);
  });

  test("E01/E02/E03 — Home autenticada, shell propio, identidad visible", async ({ page }) => {
    await expect(page).toHaveURL(new RegExp(`/${student.community}$`));
    await expect(page.getByText(/good (morning|afternoon|evening)|buenos días|buenas tardes|buenas noches/i)).toBeVisible();
    await expect(page.getByText(/^QA$|, QA/)).toBeVisible();
  });

  test("E04 — wallet de SegoTokens visible con saldo numérico", async ({ page }) => {
    await expect(page.getByText("SEGOTOKENS")).toBeVisible();
    await expect(page.locator("p.tabular-nums").first()).toBeVisible();
  });

  test("E06/E07/E10 — nav (sidebar desktop): Explore, Rewards, Profile, Scan", async ({ page }) => {
    const sidebar = page.getByRole("navigation").first();
    await expect(sidebar.getByRole("link", { name: /^explore$|^explorar$/i })).toHaveAttribute("href", `/${student.community}/explore`);
    await expect(sidebar.getByRole("link", { name: /^rewards$|^recompensas$/i })).toHaveAttribute("href", `/${student.community}/rewards`);
    await expect(sidebar.getByRole("link", { name: /^profile$|^perfil$/i })).toHaveAttribute("href", `/${student.community}/profile`);
    await expect(page.locator(`a[href="/${student.community}/scan"]`).first()).toBeVisible();
  });

  test("E16/E17/E18 — sin nav de Admin, Venue App ni Portal del Empleado", async ({ page }) => {
    await expect(page.getByRole("link", { name: /^admin$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /mi local|venue app/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /portal del empleado/i })).toHaveCount(0);
  });

  test("E19 — deep link directo a Explore funciona con sesión activa", async ({ page }) => {
    await page.goto(`/${student.community}/explore`);
    await expect(page).toHaveURL(new RegExp(`/${student.community}/explore$`));
    await expect(page.getByText(/ya tengo cuenta|i have an account/i)).toHaveCount(0);
  });

  test("Perfil carga con datos del Student real, sin errores", async ({ page }) => {
    await page.goto(`/${student.community}/profile`);
    await expect(page.getByText(/^QA$|QA PRE1617/i).first()).toBeVisible();
  });
});

test.describe("BLOCK F — idioma / comunidad", () => {
  test("F03/F05 — cambiar idioma en el header persiste tras refresh", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await dismissCookieBanner(page);
    const esToggle = page.getByRole("button", { name: "ES", exact: true });
    if (await esToggle.count() > 0) {
      await esToggle.click();
      await expect(page.getByText(/buenos días|buenas tardes|buenas noches/i)).toBeVisible();
      await page.reload();
      await expect(page.getByText(/buenos días|buenas tardes|buenas noches/i)).toBeVisible();
      // deja la cuenta de vuelta en inglés (estado por defecto de IE) para no
      // afectar a otros tests de este suite que asumen el idioma por defecto.
      const enToggle = page.getByRole("button", { name: "EN", exact: true });
      if (await enToggle.count() > 0) await enToggle.click();
    } else {
      test.skip(true, "selector de idioma no visible en este shell — revisar manualmente");
    }
  });

  test("F08 — URL directa a otra comunidad (/uva) no otorga membresía real estando logueado en IE", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await dismissCookieBanner(page);
    await page.goto("/uva");
    const walletVisible = await page.getByText("SEGOTOKENS").count();
    expect(walletVisible === 0 || page.url().includes("/ie")).toBeTruthy();
  });
});
