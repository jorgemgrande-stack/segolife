/**
 * emailProvider.test.ts — Communication Center: guard anti-marca-ajena
 * (Fase 7, ya existente), routing de remitente/subject y supresión técnica
 * (spec §2/§10/§21, nuevos esta fase). mailer.ts y emailSuppressionService.ts
 * se mockean como dependencias — su propia lógica (Brevo API/SMTP fallback,
 * idempotencia de INSERT) no se duplica aquí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendEmailTracked, mockIsEmailSuppressed } = vi.hoisted(() => ({
  mockSendEmailTracked: vi.fn(),
  mockIsEmailSuppressed: vi.fn(),
}));
vi.mock("../../../mailer", () => ({ sendEmailTracked: mockSendEmailTracked }));
vi.mock("../emailSuppressionService", () => ({ isEmailSuppressed: mockIsEmailSuppressed }));

import { createEmailProvider } from "./emailProvider";
import { SENDER_IDENTITIES } from "../senderRouting";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsEmailSuppressed.mockResolvedValue(false);
  mockSendEmailTracked.mockResolvedValue({ success: true, messageId: "brevo-msg-1" });
  process.env = { ...ORIGINAL_ENV, SEGOLIFE_ENGAGEMENT_EMAIL_FROM: "Segolife <segolife@segolife.es>" };
});

function baseMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 1, title: "Título", body: "Cuerpo", deepLink: null, imageUrl: null,
    recipient: { email: "student@example.invalid" },
    ...overrides,
  } as any;
}

describe("emailProvider — configuración", () => {
  it("sin SEGOLIFE_ENGAGEMENT_EMAIL_FROM, configured=false y send() nunca intenta enviar", async () => {
    process.env.SEGOLIFE_ENGAGEMENT_EMAIL_FROM = "";
    const provider = createEmailProvider();
    expect(provider.capabilities.configured).toBe(false);
    const result = await provider.send(baseMessage());
    expect(result.status).toBe("skipped");
    expect(mockSendEmailTracked).not.toHaveBeenCalled();
  });

  it("con una marca prohibida (nayade/skicenter/rapalinahoteles), configured=false", () => {
    process.env.SEGOLIFE_ENGAGEMENT_EMAIL_FROM = "Skicenter <reservas@skicenter.es>";
    expect(createEmailProvider().capabilities.configured).toBe(false);
  });

  it("configurado correctamente, supportsDeliveryStatus=true (el webhook de Brevo ya existe esta fase)", () => {
    expect(createEmailProvider().capabilities.supportsDeliveryStatus).toBe(true);
  });
});

describe("emailProvider — supresión técnica (spec §21)", () => {
  it("un email suprimido se omite ANTES de llamar a sendEmailTracked", async () => {
    mockIsEmailSuppressed.mockResolvedValue(true);
    const provider = createEmailProvider();
    const result = await provider.send(baseMessage());
    expect(result.status).toBe("skipped");
    expect(result.error).toMatch(/suppressed/i);
    expect(mockSendEmailTracked).not.toHaveBeenCalled();
  });
});

describe("emailProvider — remitente y subject (spec §2/§10)", () => {
  it("con senderIdentity en el mensaje, se usa ESE remitente, no el SEGOLIFE_ENGAGEMENT_EMAIL_FROM genérico", async () => {
    const provider = createEmailProvider();
    await provider.send(baseMessage({ senderIdentity: SENDER_IDENTITIES.community }));
    expect(mockSendEmailTracked).toHaveBeenCalledOnce();
    expect(mockSendEmailTracked.mock.calls[0][0].from).toBe("Segolife Community <community@segolife.es>");
  });

  it("sin senderIdentity, cae al remitente genérico configurado", async () => {
    const provider = createEmailProvider();
    await provider.send(baseMessage());
    expect(mockSendEmailTracked.mock.calls[0][0].from).toBe("Segolife <segolife@segolife.es>");
  });

  it("con subject explícito, se usa como asunto del email — nunca `title`", async () => {
    const provider = createEmailProvider();
    await provider.send(baseMessage({ subject: "Asunto específico" }));
    expect(mockSendEmailTracked.mock.calls[0][0].subject).toBe("Asunto específico");
  });

  it("sin subject, cae a `title` (comportamiento previo preservado)", async () => {
    const provider = createEmailProvider();
    await provider.send(baseMessage({ title: "Título como asunto" }));
    expect(mockSendEmailTracked.mock.calls[0][0].subject).toBe("Título como asunto");
  });
});

describe("emailProvider — resultado y externalMessageId", () => {
  it("un envío exitoso devuelve status=sent y el messageId de Brevo (para el webhook, spec §20)", async () => {
    const provider = createEmailProvider();
    const result = await provider.send(baseMessage());
    expect(result.status).toBe("sent");
    expect(result.externalMessageId).toBe("brevo-msg-1");
  });

  it("un fallo de sendEmailTracked devuelve status=failed", async () => {
    mockSendEmailTracked.mockResolvedValue({ success: false });
    const provider = createEmailProvider();
    const result = await provider.send(baseMessage());
    expect(result.status).toBe("failed");
  });

  it("sin email de destinatario, skipped — nunca llama a sendEmailTracked", async () => {
    const provider = createEmailProvider();
    const result = await provider.send(baseMessage({ recipient: {} }));
    expect(result.status).toBe("skipped");
    expect(mockSendEmailTracked).not.toHaveBeenCalled();
  });
});
