import { test, expect } from "@playwright/test";
import { student } from "./fixtures/credentials";

/**
 * mg05-student-voting-config.responsive.spec.ts — MG-05 (Student Proposal
 * Voting Configuration). QA visual real en producción, con la cuenta
 * Student QA dedicada — SOLO estados de formulario, nunca Submit real (no
 * existe un mecanismo de limpieza seguro para una idea de estudiante ya
 * enviada, spec §24: "no contaminar producción").
 */
async function loginStudent(page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', student.email);
  await page.fill('input[type="password"]', student.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(new RegExp(`/${student.community}`), { timeout: 10000 });
}

test.describe("MG-05 — Student: configuración de voto propuesta (formulario, sin Submit real)", () => {
  test(`/${"ie"}/comunity → Propose: selector de tipos, opciones dinámicas y validación, sin overflow`, async ({ page }) => {
    await loginStudent(page);
    await page.goto(`/${student.community}/comunity`);
    await expect(page).not.toHaveURL(/\/login/);
    await page.getByRole("tab", { name: /propose|proponer/i }).click();

    await expect(page.getByText(/how should the community respond|cómo debería responder/i)).toBeVisible();

    const combobox = page.getByText(/how should the community respond|cómo debería responder/i).locator("..").locator("[role=combobox]");
    await combobox.click();
    await page.getByRole("option", { name: /single choice|elección única/i }).click();

    const optionInputs = page.getByPlaceholder(/^option \d|^opción \d/i);
    await expect(optionInputs).toHaveCount(2);
    const submitBtn = page.getByRole("button", { name: /submit idea|enviar idea/i });
    await expect(submitBtn).toBeDisabled();

    await optionInputs.nth(0).fill("Thursday");
    await optionInputs.nth(1).fill("Friday");
    await page.getByRole("button", { name: /add option|añadir opción/i }).click();
    await expect(optionInputs).toHaveCount(3);

    // Sin overflow horizontal en ningún viewport.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Volver a "no proponer" — nunca se pulsa Submit en este spec.
    await combobox.click();
    await page.getByRole("option", { name: /don't propose|no proponer/i }).click();
    await expect(page.getByPlaceholder(/^option \d|^opción \d/i)).toHaveCount(0);
  });

  test(`escala 0-100 y ranking muestran la UI de opciones/criterios correcta, sin overflow`, async ({ page }) => {
    await loginStudent(page);
    await page.goto(`/${student.community}/comunity`);
    await page.getByRole("tab", { name: /propose|proponer/i }).click();

    const combobox = page.getByText(/how should the community respond|cómo debería responder/i).locator("..").locator("[role=combobox]");
    await combobox.click();
    await page.getByRole("option", { name: /0-100 scale|escala 0-100/i }).click();
    await expect(page.getByText(/criteria to score|criterios a puntuar/i)).toBeVisible();

    await combobox.click();
    await page.getByRole("option", { name: /^ranking$/i }).click();
    await expect(page.getByPlaceholder(/^option \d|^opción \d/i)).toHaveCount(2);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
