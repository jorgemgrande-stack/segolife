import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { student } from "./fixtures/credentials";
import { loginViaUI } from "./fixtures/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * MG-04 — QA visual final: formulario "Proponer" (Community Proposals 2.0)
 * contra producción real. .responsive.spec.ts para correr en los 3
 * proyectos (desktop 1440×900, mobile 390×844, tablet 1024×768).
 *
 * Reutiliza la MISMA imagen QA sintética de MG-03
 * (fixtures/mg03-qa-avatar.jpg) para la subida de imagen de portada — nunca
 * una fotografía de persona real.
 *
 * DELIBERADAMENTE nunca pulsa "Submit idea" — no existe un mecanismo de
 * borrado/cleanup para una propuesta de Student ya creada (solo transición
 * de estado vía Admin, sin credencial QA disponible en este entorno), así
 * que crear una propuesta real dejaría un registro huérfano sin forma
 * segura de limpiarlo. El envío final (submitProposal → BD) ya está
 * cubierto por community.test.ts/communityStudentProposalDb.test.ts
 * (server) y por ComunityHub.test.tsx (payload exacto, sin red real) —
 * aquí se valida todo lo demás end-to-end: subida de imagen real (si
 * llega a servidor), interacción, validación cliente, ausencia de
 * selector de comunidad, red, consola.
 */

const QA_IMAGE_PATH = path.join(__dirname, "fixtures", "mg03-qa-avatar.jpg");
const ARTIFACTS_DIR = "artifacts/mg03b-mg04-visual-qa";
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

async function dismissCookies(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /accept all|aceptar todas/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) await btn.click();
}

function hasHorizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
}

test.describe("MG-04 — Community Proposals 2.0: formulario Proponer (QA visual final)", () => {
  test("imagen, urgencia, fecha y ausencia de selector de comunidad — nunca se envía la propuesta", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    const imageUploadRequests: string[] = [];
    const badResponses: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/api/community/proposal-image")) imageUploadRequests.push(`${res.status()} ${res.url()}`);
      if (res.status() >= 400 && res.url().includes("/api/")) badResponses.push(`${res.status()} ${res.url()}`);
    });

    await loginViaUI(page, student.email, student.password);
    await page.goto(`/${student.community}/comunity`);
    await page.waitForLoadState("networkidle");
    await dismissCookies(page);

    await page.getByRole("tab", { name: /^propose$|^proponer$/i }).click();

    // A — campos base visibles.
    const titleInput = page.getByPlaceholder(/padel tournament|torneo de pádel/i);
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/related venue|local relacionado/i)).toBeVisible();
    const addImageBtn = page.getByRole("button", { name: /add image|añadir imagen/i });
    await expect(addImageBtn).toBeVisible();
    await expect(page.getByRole("button", { name: /^no rush$|^sin prisa$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^soon$|^pronto$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^urgent$|^urgente$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /this weekend|este finde/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /next week|la semana que viene/i })).toBeVisible();

    // B — nunca existe un selector de comunidad en este formulario (spec §11).
    await expect(page.getByText(/target community|comunidad objetivo|alcance administrativo|administrative scope/i)).not.toBeVisible();

    await titleInput.fill("[QA] Visual Proposal Test — DELETE (nunca enviado)");

    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-community-form.png`, fullPage: false });

    // C — imagen inválida (SVG, riesgo XSS/XXE) rechazada en cliente, sin llegar a red.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "bad.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    });
    await page.waitForTimeout(500); // el rechazo es síncrono client-side — margen generoso, no una espera de red real
    await expect(page.getByRole("button", { name: /remove image|quitar imagen/i })).not.toBeVisible();
    expect(imageUploadRequests, "una imagen inválida nunca debe llegar a red").toEqual([]);

    // D — imagen válida: sube de verdad, preview visible, sin overflow.
    await fileInput.setInputFiles(QA_IMAGE_PATH);
    await expect(page.getByRole("button", { name: /remove image|quitar imagen/i })).toBeVisible({ timeout: 15000 });
    // Selector acotado a la key real de communityProposalImageService.ts
    // (`community-proposals/{studentId}/...`) — un selector genérico
    // `img[src^="https://"]` también cazaría el logo de marca del header,
    // que en mobile/tablet puede estar oculto (nav colapsada) y hace
    // fallar `.first()` sin que el bug sea de la preview real.
    await expect(page.locator('img[src*="community-proposals/"]')).toBeVisible();
    expect(imageUploadRequests.length, `subida de imagen: ${imageUploadRequests.join(" | ")}`).toBe(1);
    expect(imageUploadRequests[0].startsWith("200"), `respuesta de subida no-200: ${imageUploadRequests[0]}`).toBe(true);
    const hasOverflowImage = await hasHorizontalOverflow(page);
    expect(hasOverflowImage, "overflow horizontal con preview de imagen").toBe(false);
    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-community-image-preview.png`, fullPage: false });

    // E — quitar imagen vuelve a "Add image".
    await page.getByRole("button", { name: /remove image|quitar imagen/i }).click();
    await expect(addImageBtn).toBeVisible();

    // F — urgencia: seleccionar/deseleccionar, estado activo distinguible por clase real (variant default vs outline).
    // El botón tiene `transition-all` (150ms) — el className cambia de
    // forma síncrona al hacer click, pero el color TARDA ese medio segundo
    // en asentarse visualmente; sin esta espera, una captura tomada justo
    // tras el click queda a medio transicionar (falso positivo de "estado
    // apenas distinguible" — no es un bug real, es una carrera con el CSS).
    const urgentBtn = page.getByRole("button", { name: /^urgent$|^urgente$/i });
    await urgentBtn.click();
    await expect(urgentBtn).toHaveClass(/bg-primary/);
    await page.mouse.move(0, 0); // fuera del botón — evita que :hover (bg-primary/90) contamine la captura del estado "seleccionado" real
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${ARTIFACTS_DIR}/${testInfo.project.name}-community-urgency.png`, fullPage: false });
    await urgentBtn.click(); // deseleccionar
    await expect(urgentBtn).not.toHaveClass(/bg-primary/);
    // Ninguno de los 3 botones de urgencia en sí menciona SegoTokens — la
    // urgencia nunca concede recompensa (spec §9/§16). NO se comprueba en
    // toda la página: el formulario ya muestra, en otra sección totalmente
    // aparte, el hint condicional preexistente "si tu idea es aprobada
    // ganas +N ST" (Fase 10.6, real y correcto — ligado a la APROBACIÓN,
    // nunca a la urgencia) que legítimamente contiene el mismo patrón "+N ST".
    for (const name of [/^no rush$|^sin prisa$/i, /^soon$|^pronto$/i, /^urgent$|^urgente$/i]) {
      const text = await page.getByRole("button", { name }).textContent();
      expect(text ?? "", `el botón de urgencia "${text}" nunca debe mencionar ST`).not.toMatch(/\bST\b/i);
    }

    // G — fecha: preset → luego fecha personalizada deja un estado coherente (preset ya no queda marcado como activo).
    const weekendBtn = page.getByRole("button", { name: /this weekend|este finde/i });
    await weekendBtn.click();
    await expect(weekendBtn).toHaveClass(/bg-primary/);
    const dateInput = page.locator('input[type="date"]');
    const customDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await dateInput.fill(customDate);
    await expect(weekendBtn).not.toHaveClass(/bg-primary/);
    await expect(page.getByText(/^clear$|^quitar$/i)).toBeVisible();
    await page.getByText(/^clear$|^quitar$/i).click();
    await expect(dateInput).toHaveValue("");

    const hasOverflowFinal = await hasHorizontalOverflow(page);
    expect(hasOverflowFinal, "overflow horizontal en el formulario completo").toBe(false);

    // H — nunca se envía la propuesta (ver cabecera del fichero).
    await expect(page.getByRole("button", { name: /submit idea|enviar idea/i })).toBeVisible();

    // Mismo filtro que mg02-reward-visibility/mg03b-activity — ruido de red
    // genérico y transitorio nunca es la comprobación real de este test.
    const relevantErrors = consoleErrors.filter(e => !/google|gtag|analytics|extension:\/\/|failed to fetch/i.test(e));
    expect(relevantErrors, `console.error inesperados: ${relevantErrors.join(" | ")}`).toEqual([]);
    expect(badResponses, `respuestas 4xx/5xx inesperadas: ${badResponses.join(" | ")}`).toEqual([]);
  });
});
