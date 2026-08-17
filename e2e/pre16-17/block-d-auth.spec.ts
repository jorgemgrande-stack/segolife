import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

test.describe("BLOCK D — validación de formulario (sin crear cuenta)", () => {
  test("D01 — ?community=ie preselecciona IE en el paso 2", async ({ page }) => {
    await page.goto("/register?community=ie");
    await page.locator("#firstName").fill("QA");
    await page.locator("#lastName").fill("PreProd");
    await page.locator("#email").fill(`qa.discard.${Date.now()}@segolife.es`);
    await page.locator("#phone").fill("600000000");
    await page.locator("#password").fill("Descartar123!");
    await page.locator("#passwordConfirm").fill("Descartar123!");
    await page.getByRole("button", { name: /continuar|continue/i }).click();
    await expect(page.getByRole("button", { name: /segolife ie/i, exact: false })).toHaveAttribute("aria-pressed", "true");
  });

  test("D03 — paso 1 no avanza con campos obligatorios vacíos", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: /continuar|continue/i }).click();
    await expect(page.locator("text=/paso 2|step 2|2\\./i").first()).not.toHaveClass(/text-primary/);
  });

  test("D05 — contraseña corta (<8) es rechazada antes de avanzar", async ({ page }) => {
    await page.goto("/register");
    await page.locator("#firstName").fill("QA");
    await page.locator("#lastName").fill("Test");
    await page.locator("#email").fill("qa.shortpass@segolife.es");
    await page.locator("#phone").fill("600000000");
    await page.locator("#password").fill("abc123");
    await page.locator("#passwordConfirm").fill("abc123");
    await page.getByRole("button", { name: /continuar|continue/i }).click();
    await expect(page.getByText(/WEAK_PASSWORD|al menos 8|at least 8/i)).toBeVisible();
  });
});

test.describe.serial("BLOCK D — cuenta Student QA controlada, real, end-to-end", () => {
  test("D06/D07 — registro completo (cuenta nueva) o rechazo por email duplicado (si ya existía de una ejecución previa)", async ({ page }) => {
    await page.goto(`/register?community=${student.community}`);
    await page.locator("#firstName").fill("QA");
    await page.locator("#lastName").fill("PRE1617");
    await page.locator("#email").fill(student.email);
    await page.locator("#phone").fill("600000001");
    await page.locator("#password").fill(student.password);
    await page.locator("#passwordConfirm").fill(student.password);
    await page.getByRole("button", { name: "Continuar" }).click();

    await page.locator("#acceptTerms").click();
    await expect(page.getByRole("button", { name: "Crear mi cuenta" })).toBeEnabled();

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/auth/register")),
      page.getByRole("button", { name: "Crear mi cuenta" }).click(),
    ]);
    const status = response.status();
    // 201 = cuenta nueva creada (D07). 409/400 con EMAIL_EXISTS = ya existía
    // de una ejecución anterior de este mismo suite (D06) — ambos son un
    // resultado VÁLIDO y esperado; lo que NO es válido es cualquier otro
    // código (ahí sí falla el test de verdad).
    expect([201, 400, 409]).toContain(status);
    if (status === 201) {
      await page.waitForURL((u) => u.pathname === `/${student.community}`, { timeout: 10000 });
    } else {
      await expect(page.getByText(/ya existe|already exists|EMAIL_EXISTS/i)).toBeVisible();
    }
  });

  test("D08/D09 — login con contraseña incorrecta rechaza, con la correcta entra", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(student.email);
    await page.locator("#password").fill("contraseña-incorrecta-a-proposito");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(/incorrect|inválid|invalid credentials/i)).toBeVisible();

    await loginViaUI(page, student.email, student.password);
    expect(page.url()).not.toContain("/login");
  });

  test("D11 — la sesión sobrevive a un refresh", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    const urlAfterLogin = page.url();
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toBe(urlAfterLogin);
    await expect(page.getByRole("link", { name: /ya tengo cuenta|iniciar sesión|log in/i })).toHaveCount(0);
  });

  test("D12 — login con returnTo lleva exactamente ahí, no al home por rol", async ({ page }) => {
    await loginViaUI(page, student.email, student.password, "/ie/explore");
    expect(page.url()).toContain("/ie/explore");
  });

  test("D14 — visitar /uva estando logueado en IE no crea membresía UVA", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto("/uva");
    // No debe aparecer un shell de Student autenticado propio de UVA —
    // la sola visita a la URL no debe otorgar membresía real.
    const html = await page.content();
    expect(html).not.toMatch(/ya eres miembro de uva|you are now a member of uva/i);
  });
});
