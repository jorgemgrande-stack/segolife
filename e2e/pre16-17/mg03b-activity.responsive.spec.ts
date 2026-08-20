import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * MG-03B — QA visual final: Profile Photo Activity contra producción real.
 * .responsive.spec.ts (mismo criterio que mg03-profile-photo) para correr
 * en los 3 proyectos (desktop 1440×900, mobile 390×844, tablet 1024×768).
 *
 * Reutiliza la MISMA imagen QA sintética que MG-03
 * (fixtures/mg03-qa-avatar.jpg — geométrica, nunca una fotografía de
 * persona real) para el ciclo añadir→reemplazar→eliminar, y verifica que
 * cada paso queda reflejado en /:community/activity con el texto correcto,
 * sin ningún importe de SegoTokens.
 */

const QA_IMAGE_PATH = path.join(__dirname, "fixtures", "mg03-qa-avatar.jpg");
const ARTIFACTS_DIR = "artifacts/mg03b-mg04-visual-qa";
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

async function ensureNoLeftoverPhoto(request: import("@playwright/test").APIRequestContext) {
  const loginRes = await request.post("https://www.segolife.es/api/auth/login", {
    data: { email: student.email, password: student.password },
  });
  if (!loginRes.ok()) return;
  await request.post("https://www.segolife.es/api/trpc/students.removeMyPhoto?batch=1", {
    data: { 0: { json: null } },
  }).catch(() => {});
}

function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
}

test.describe("MG-03B — Profile Photo Activity (QA visual final)", () => {
  test.afterEach(async ({ request }) => {
    await ensureNoLeftoverPhoto(request);
  });

  test("added → updated → removed se reflejan en /activity, sin ST, orden temporal correcto", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    const networkFailures: string[] = [];
    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().includes("/api/students/") /* 404 de avatar sin foto es esperado */) {
        networkFailures.push(`${res.status()} ${res.url()}`);
      }
    });

    await loginViaUI(page, student.email, student.password);

    // ADDED — primera subida (estado inicial confirmado sin foto, igual que mg03-profile-photo).
    await page.goto(`/${student.community}/profile`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);
    await page.locator('input[type="file"]').setInputFiles(QA_IMAGE_PATH);
    await expect(page.getByText(/^(change photo|cambiar foto)$/i)).toBeVisible({ timeout: 15000 });

    await page.goto(`/${student.community}/activity`);
    await page.waitForLoadState("networkidle");
    // .first() — Activity es un HISTORIAL acumulativo (spec §7), no un
    // estado único: correr esta prueba más de una vez (p.ej. un retry)
    // deja legítimamente varias entradas "added" pasadas — el objetivo es
    // que la MÁS RECIENTE (arriba del todo) sea la de esta ejecución, nunca
    // que sea la única en toda la cuenta.
    await expect(page.getByText(/profile photo added|foto de perfil añadida/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/\+0\s*ST/i)).not.toBeVisible();
    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-activity-added.png`, fullPage: false });

    // UPDATED — segunda subida (reemplazo, ya había foto).
    await page.goto(`/${student.community}/profile`);
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"]').setInputFiles(QA_IMAGE_PATH);
    await expect(page.getByText(/^(change photo|cambiar foto)$/i)).toBeVisible({ timeout: 15000 });

    await page.goto(`/${student.community}/activity`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/profile photo updated|foto de perfil actualizada/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/\+0\s*ST/i)).not.toBeVisible();
    const hasOverflowMid = await hasHorizontalOverflow(page);
    expect(hasOverflowMid, "overflow horizontal en /activity").toBe(false);
    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-activity-updated.png`, fullPage: false });

    // REMOVED — con confirmación real (mismo flujo que mg03-profile-photo).
    await page.goto(`/${student.community}/profile`);
    await page.waitForLoadState("networkidle");
    await page.getByText(/remove photo|eliminar foto/i).click();
    await expect(page.getByText(/remove profile photo\?|eliminar foto de perfil\?/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /^(remove photo|eliminar foto)$/i }).last().click();
    await expect(page.getByText(/^(add photo|añadir foto)$/i)).toBeVisible({ timeout: 10000 });

    await page.goto(`/${student.community}/activity`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/profile photo removed|foto de perfil eliminada/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/\+0\s*ST/i)).not.toBeVisible();

    // Orden temporal — el evento más reciente (removed, de ESTA ejecución)
    // debe aparecer ANTES (más arriba en el DOM) que el updated más
    // reciente, mismo criterio "más reciente primero" que el resto del
    // historial de Activity. .first() en ambos — puede haber entradas de
    // ejecuciones QA anteriores más abajo en el historial.
    const removedY = await page.getByText(/profile photo removed|foto de perfil eliminada/i).first().boundingBox();
    const updatedY = await page.getByText(/profile photo updated|foto de perfil actualizada/i).first().boundingBox();
    expect(removedY, "removed debe ser visible").not.toBeNull();
    expect(updatedY, "updated debe ser visible").not.toBeNull();
    if (removedY && updatedY) {
      expect(removedY.y, "removed debe renderizarse antes (más arriba) que updated").toBeLessThan(updatedY.y);
    }

    const hasOverflowFinal = await hasHorizontalOverflow(page);
    expect(hasOverflowFinal, "overflow horizontal en /activity (final)").toBe(false);
    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-activity-removed.png`, fullPage: false });

    // Mismo filtro que mg02-reward-visibility — ruido de red genérico y
    // transitorio (queries canceladas por navegación entre page.goto())
    // nunca es la comprobación real de este test; la comprobación real ya
    // ocurrió arriba (los textos de cada acción SÍ aparecieron).
    const relevantErrors = consoleErrors.filter(e => !/google|gtag|analytics|extension:\/\/|failed to fetch/i.test(e));
    expect(relevantErrors, `console.error inesperados: ${relevantErrors.join(" | ")}`).toEqual([]);
    expect(networkFailures, `respuestas 4xx/5xx inesperadas: ${networkFailures.join(" | ")}`).toEqual([]);
  });
});
