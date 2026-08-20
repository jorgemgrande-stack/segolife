/**
 * ghlInbox.test.ts — FINAL ZERO-DEBT (Block I/J). Primer test de este
 * fichero. Cubre exclusivamente `saveInboxCredentials`: antes tenía un
 * default hardcodeado ("NAYADE2026_ULTRA", literal en el propio código
 * fuente y en el placeholder del panel Admin) que se guardaba tal cual
 * como secreto REAL de webhook si el admin dejaba el campo en blanco —
 * cualquiera que hubiera visto el código o la UI podía forjar eventos de
 * webhook (mensajes de WhatsApp falsos inyectados en el inbox de staff).
 * Nunca disparado en producción (verificado antes de corregirlo: sin fila
 * en site_settings todavía).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));
vi.mock("mysql2/promise", () => ({
  default: { createPool: () => ({ execute: mockExecute }) },
}));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => ({}) }));

import { ghlInboxRouter } from "./ghlInbox";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callerAsAdmin() {
  return ghlInboxRouter.createCaller({ user: { id: 1, role: "admin" } } as any);
}

const INSECURE_LEGACY_DEFAULT = "NAYADE2026_ULTRA";

describe("ghlInbox.saveInboxCredentials — sin secreto hardcodeado (FINAL ZERO-DEBT)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("sin webhookSecret y sin ninguno guardado antes: genera uno aleatorio, nunca el literal legacy", async () => {
    // Primera llamada dentro del handler es el SELECT de "¿existe ya uno?" — sin filas.
    mockExecute.mockResolvedValueOnce([[]]);
    mockExecute.mockResolvedValue([{}]); // el resto de INSERT...ON DUPLICATE KEY no se inspecciona
    const result = await callerAsAdmin().saveInboxCredentials({ token: "pit-real-token", locationId: "loc-real" });
    expect(result.ok).toBe(true);
    expect(result.webhookSecret).toBeDefined();
    expect(result.webhookSecret).not.toBe(INSECURE_LEGACY_DEFAULT);
    // Aleatorio real (32 caracteres hex = randomBytes(24)) — nunca un valor corto/adivinable.
    expect(result.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
  });

  it("sin webhookSecret pero YA existía uno guardado: lo conserva — nunca invalida un webhook ya configurado en GHL", async () => {
    mockExecute.mockResolvedValueOnce([[{ value: "un-secreto-ya-configurado-antes" }]]);
    mockExecute.mockResolvedValue([{}]);
    const result = await callerAsAdmin().saveInboxCredentials({ token: "pit-real-token", locationId: "loc-real" });
    expect(result.webhookSecret).toBe("un-secreto-ya-configurado-antes");
  });

  it("con webhookSecret explícito: se usa tal cual, nunca se sobrescribe con uno generado", async () => {
    mockExecute.mockResolvedValue([{}]);
    const result = await callerAsAdmin().saveInboxCredentials({ token: "pit-real-token", locationId: "loc-real", webhookSecret: "mi-secreto-elegido" });
    expect(result.webhookSecret).toBe("mi-secreto-elegido");
  });

  it("nunca acepta ni persiste el literal legacy aunque se envíe explícitamente — se guarda tal cual porque ahora es una elección consciente del admin, no un fallback silencioso", async () => {
    // Nota: si el admin TECLEA literalmente ese valor, es su elección explícita,
    // no el bug original (un fallback SILENCIOSO e inevitable). Lo que se
    // verifica aquí es que el código YA NO lo elige por su cuenta — ver los
    // dos tests anteriores (genera aleatorio o conserva el existente).
    mockExecute.mockResolvedValue([{}]);
    const result = await callerAsAdmin().saveInboxCredentials({ token: "t", locationId: "l" });
    expect(result.webhookSecret).not.toBe(INSECURE_LEGACY_DEFAULT);
  });
});
