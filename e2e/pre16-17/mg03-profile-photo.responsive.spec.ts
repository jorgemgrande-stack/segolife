import { test, expect } from "@playwright/test";
import path from "path";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

/**
 * MG-03 — ciclo de vida completo de la foto de perfil del Student, contra
 * producción real. Nombre .responsive.spec.ts (mismo criterio que
 * mg01/mg02) para correr en los 3 proyectos (desktop 1440×900, mobile
 * 390×844, tablet 1024×768).
 *
 * ASSET QA: e2e/pre16-17/fixtures/mg03-qa-avatar.jpg es una imagen
 * geométrica sintética generada con sharp (fondo morado, círculo amarillo,
 * cuadrado verde) — nunca una fotografía de una persona real (spec §23).
 *
 * ESTADO FINAL: verificado por lectura directa (login REST) antes de
 * escribir este spec que el Student QA (userId=14) tiene avatarUrl=null
 * hoy. El test SIEMPRE termina eliminando la foto que él mismo sube — un
 * `test.afterEach` adicional (best-effort, vía la misma sesión REST) actúa
 * de red de seguridad si alguna aserción intermedia fallara antes de llegar
 * al paso de eliminación normal del flujo.
 */

const QA_IMAGE_PATH = path.join(__dirname, "fixtures", "mg03-qa-avatar.jpg");

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

/** Red de seguridad — nunca deja al Student QA con una foto MG-03 huérfana aunque el test falle a mitad. */
async function ensureNoLeftoverPhoto(request: import("@playwright/test").APIRequestContext) {
  const loginRes = await request.post("https://www.segolife.es/api/auth/login", {
    data: { email: student.email, password: student.password },
  });
  if (!loginRes.ok()) return;
  // httpBatchLink (ver client/src/main.tsx) — incluso una única mutación
  // sin input viaja en formato batch: ?batch=1 + {"0":{"json":null}}.
  await request.post("https://www.segolife.es/api/trpc/students.removeMyPhoto?batch=1", {
    data: { 0: { json: null } },
  }).catch(() => {});
}

test.describe("MG-03 — Student Profile Photo", () => {
  test.afterEach(async ({ request }) => {
    await ensureNoLeftoverPhoto(request);
  });

  test("ciclo completo: iniciales → subir → persiste → eliminar → vuelve a iniciales", async ({ page }) => {
    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/profile`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    // A/B/C — Profile carga, avatar actual visible. DATA STATE confirmado
    // antes de este spec: el Student QA no tiene foto hoy, así que el
    // estado inicial esperado es iniciales — si un run anterior dejó una
    // foto huérfana (no debería, ver afterEach), este mismo test la
    // sustituye igualmente sin fallar.
    const changeOrAddBtn = page.getByRole("button", { name: /^(add photo|change photo|añadir foto|cambiar foto)$/i }).first();
    await expect(changeOrAddBtn).toBeVisible({ timeout: 10000 });

    // D/E — sube la imagen QA sintética.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(QA_IMAGE_PATH);

    // Tras subir, el botón pasa a "Change photo" y aparece "Remove photo" —
    // señal real de que el upload+normalizado+persistencia server-side
    // tuvieron éxito (nunca solo un toast, que en móvil puede desaparecer
    // rápido y no es una señal robusta contra la que esperar en E2E).
    await expect(page.getByRole("button", { name: /^(change photo|cambiar foto)$/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/remove photo|eliminar foto/i)).toBeVisible();

    // El avatar ahora es una <img> real (AvatarImage), no solo el fallback de iniciales.
    await expect(page.locator('img[src*="/api/students/"]').first()).toBeVisible({ timeout: 10000 });

    // F — refresh → la foto persiste (no era solo estado local de React).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /^(change photo|cambiar foto)$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('img[src*="/api/students/"]').first()).toBeVisible();

    // G — navegación → Home → vuelta a Profile → persiste (no era un
    // artefacto de la primera carga).
    await page.goto(`/${student.community}`);
    await page.waitForLoadState("networkidle");
    await page.goto(`/${student.community}/profile`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /^(change photo|cambiar foto)$/i })).toBeVisible({ timeout: 10000 });

    // H — responsive: sin overflow horizontal con la foto real cargada.
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(hasOverflow, "overflow horizontal en Profile con foto real").toBe(false);

    // I — eliminar, con confirmación real (spec §6/§15).
    await page.getByText(/remove photo|eliminar foto/i).click();
    const confirmDialog = page.getByText(/remove profile photo\?|eliminar foto de perfil\?/i);
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /^(remove photo|eliminar foto)$/i }).last().click();

    // J — vuelve a iniciales sin recargar (misma exigencia que "aparece sin
    // requerir logout/login", spec §6, aplicada también al camino inverso).
    await expect(page.getByRole("button", { name: /^(add photo|añadir foto)$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/remove photo|eliminar foto/i)).not.toBeVisible();

    // K — refresh → la eliminación también persiste (no era solo estado local).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /^(add photo|añadir foto)$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('img[src*="/api/students/"]')).toHaveCount(0);
  });
});
