/**
 * mailer.test.ts — SEGOLIFE COMMUNICATION CENTER CONSOLIDATION (Fase 11,
 * spec §8/§64/§82 items 19-20). Auditoría de esta fase confirmó que
 * mailer.ts (el transporte HTTP real de Brevo que sendEmailTracked/
 * emailProvider.ts usan) NUNCA tenía cobertura de test propia — el fix
 * histórico de `cc: []` (Brevo rechaza un array vacío con 400) solo estaba
 * verificable leyendo el código. Este archivo cierra ese hueco: el
 * comportamiento real de red se prueba mockeando `fetch` global, nunca
 * llamando a la API real de Brevo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, BREVO_API_KEY: "test-brevo-key" };
  delete process.env.GLOBAL_CC_EMAIL;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function mockFetchOnce(response: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  return vi.spyOn(global, "fetch").mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: response.json ?? (async () => ({ messageId: "brevo-msg-1" })),
    text: response.text ?? (async () => "error body"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe("mailer.ts — cc:[] nunca se envía a Brevo (bug histórico, Fase 11 spec §64)", () => {
  it("sin cc ni GLOBAL_CC_EMAIL: el payload a Brevo NUNCA incluye la clave 'cc'", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const { sendEmailTracked } = await import("./mailer");
    await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty("cc");
  });

  it("con GLOBAL_CC_EMAIL configurado pero sin cc explícito: el payload SÍ incluye cc con esa dirección", async () => {
    process.env.GLOBAL_CC_EMAIL = "audit@segolife.es";
    const fetchMock = mockFetchOnce({ ok: true });
    const { sendEmailTracked } = await import("./mailer");
    await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" });

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.cc).toEqual([{ email: "audit@segolife.es" }]);
  });

  it("con cc explícito Y GLOBAL_CC_EMAIL: se combinan sin duplicados", async () => {
    process.env.GLOBAL_CC_EMAIL = "audit@segolife.es";
    const fetchMock = mockFetchOnce({ ok: true });
    const { sendEmailTracked } = await import("./mailer");
    await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>", cc: "audit@segolife.es" });

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.cc).toEqual([{ email: "audit@segolife.es" }]);
  });

  it("sin adjuntos: el payload NUNCA incluye la clave 'attachment' (mismo criterio que cc)", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const { sendEmailTracked } = await import("./mailer");
    await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" });

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty("attachment");
  });
});

describe("mailer.ts — propagación de fallos (spec §14, 'no silent success')", () => {
  it("Brevo responde no-2xx: sendEmailTracked devuelve success=false, nunca lanza ni finge éxito", async () => {
    mockFetchOnce({ ok: false, status: 400, text: async () => "cc is missing" });
    const { sendEmailTracked } = await import("./mailer");
    const result = await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" });
    expect(result.success).toBe(false);
    expect(result.messageId).toBeUndefined();
  });

  it("fetch lanza una excepción de red: sendEmailTracked devuelve success=false, nunca la deja escapar", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    const { sendEmailTracked } = await import("./mailer");
    await expect(sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" })).resolves.toEqual({ success: false });
  });

  it("éxito real: devuelve success=true y el messageId de Brevo (para correlacionar el webhook de entrega)", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ messageId: "brevo-real-id-123" }) });
    const { sendEmailTracked } = await import("./mailer");
    const result = await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" });
    expect(result).toEqual({ success: true, messageId: "brevo-real-id-123" });
  });

  it("sin BREVO_API_KEY configurada: nunca llama a fetch, cae directo a SMTP (sin SMTP configurado, success=false)", async () => {
    delete process.env.BREVO_API_KEY;
    const fetchMock = vi.spyOn(global, "fetch");
    const { sendEmailTracked } = await import("./mailer");
    const result = await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("sendEmail() (contrato booleano legacy) sigue reflejando el resultado real, nunca true en un fallo", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    const { sendEmail } = await import("./mailer");
    await expect(sendEmail({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" })).resolves.toBe(false);
  });
});

describe("mailer.ts — remitente real de Brevo (spec §64, request real a la API)", () => {
  it("usa el endpoint real api.brevo.com y la api-key en el header", async () => {
    const fetchMock = mockFetchOnce({ ok: true });
    const { sendEmailTracked } = await import("./mailer");
    await sendEmailTracked({ to: "student@example.com", subject: "Asunto", html: "<p>Hola</p>" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "api-key": "test-brevo-key" }) })
    );
  });
});
