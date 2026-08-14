/**
 * rewardStateMachine.test.ts — puro, sin BD. Cubre spec §4-5: estados,
 * clasificación temporal/permanente, límite de reintentos, regeneración
 * tras reversión.
 */
import { describe, it, expect } from "vitest";
import {
  isPermanentDenial,
  buildNextAttempt,
  buildRegeneratedAttempt,
  shouldAttemptReward,
  deriveRewardState,
  MAX_RETRY_ATTEMPTS,
  type RewardAttempt,
} from "./rewardStateMachine";

describe("isPermanentDenial", () => {
  it("CUTOFF_BLOCKED es permanente — un hecho histórico fijo nunca cambia", () => {
    expect(isPermanentDenial("CUTOFF_BLOCKED")).toBe(true);
  });
  it("GLOBAL_LIVE_DISABLED es permanente — mismo criterio que CUTOFF_BLOCKED, solo cambia con un commit revisado (SegoTokens Live Activation, spec §19)", () => {
    expect(isPermanentDenial("GLOBAL_LIVE_DISABLED")).toBe(true);
  });
  it("OUTSIDE_SCHEDULE, RULE_LIMIT_EXCEEDED, NO_RULE_FOUND, UNKNOWN_IDENTITY son temporales", () => {
    expect(isPermanentDenial("OUTSIDE_SCHEDULE")).toBe(false);
    expect(isPermanentDenial("RULE_LIMIT_EXCEEDED")).toBe(false);
    expect(isPermanentDenial("NO_RULE_FOUND")).toBe(false);
    expect(isPermanentDenial("UNKNOWN_IDENTITY")).toBe(false);
  });
});

describe("buildNextAttempt", () => {
  it("primer intento concedido → GRANTED, attempts=1, retryable=false", () => {
    const attempt = buildNextAttempt({ ledgerId: 42, reason: null }, null, new Date("2026-08-14"));
    expect(attempt).toMatchObject({ status: "GRANTED", ledgerId: 42, attempts: 1, generation: 0, retryable: false });
  });

  it("primer intento denegado por causa temporal → DENIED_TEMPORARY, retryable=true", () => {
    const attempt = buildNextAttempt({ ledgerId: null, reason: "RULE_LIMIT_EXCEEDED" }, null);
    expect(attempt.status).toBe("DENIED_TEMPORARY");
    expect(attempt.retryable).toBe(true);
    expect(attempt.attempts).toBe(1);
  });

  it("denegado por CUTOFF_BLOCKED → DENIED_PERMANENT inmediatamente, sin importar el nº de intento", () => {
    const attempt = buildNextAttempt({ ledgerId: null, reason: "CUTOFF_BLOCKED" }, null);
    expect(attempt.status).toBe("DENIED_PERMANENT");
    expect(attempt.retryable).toBe(false);
  });

  it("acumula intentos sobre un DENIED_TEMPORARY previo", () => {
    const first = buildNextAttempt({ ledgerId: null, reason: "OUTSIDE_SCHEDULE" }, null);
    const second = buildNextAttempt({ ledgerId: null, reason: "OUTSIDE_SCHEDULE" }, first);
    expect(second.attempts).toBe(2);
    expect(second.status).toBe("DENIED_TEMPORARY");
  });

  it(`al alcanzar MAX_RETRY_ATTEMPTS (${MAX_RETRY_ATTEMPTS}) pasa a DENIED_PERMANENT — nunca reintentos infinitos`, () => {
    let attempt: RewardAttempt | null = null;
    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      attempt = buildNextAttempt({ ledgerId: null, reason: "RULE_LIMIT_EXCEEDED" }, attempt);
    }
    expect(attempt!.attempts).toBe(MAX_RETRY_ATTEMPTS);
    expect(attempt!.status).toBe("DENIED_PERMANENT");
    expect(attempt!.retryable).toBe(false);
  });

  it("preserva la generación del intento anterior", () => {
    const previous: RewardAttempt = { status: "DENIED_TEMPORARY", reason: "OUTSIDE_SCHEDULE", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 2, retryable: true };
    const next = buildNextAttempt({ ledgerId: 5, reason: null }, previous);
    expect(next.generation).toBe(2);
  });
});

describe("buildRegeneratedAttempt (spec §3 — refunded → paid tras reversión)", () => {
  it("reinicia el contador de intentos e incrementa la generación", () => {
    const granted: RewardAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 10, generation: 0, retryable: false };
    const regenerated = buildRegeneratedAttempt(granted);
    expect(regenerated).toMatchObject({ status: "DENIED_TEMPORARY", attempts: 0, generation: 1, retryable: true, ledgerId: null });
  });
});

describe("shouldAttemptReward", () => {
  it("NOT_EVALUATED (previous=null) siempre debe intentarse", () => {
    expect(shouldAttemptReward(null)).toBe(true);
    expect(shouldAttemptReward(undefined)).toBe(true);
  });
  it("GRANTED nunca se reintenta", () => {
    const granted: RewardAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 1, generation: 0, retryable: false };
    expect(shouldAttemptReward(granted)).toBe(false);
  });
  it("DENIED_TEMPORARY con retryable=true SÍ se reintenta", () => {
    const denied: RewardAttempt = { status: "DENIED_TEMPORARY", reason: "RULE_LIMIT_EXCEEDED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: true };
    expect(shouldAttemptReward(denied)).toBe(true);
  });
  it("DENIED_PERMANENT nunca se reintenta", () => {
    const denied: RewardAttempt = { status: "DENIED_PERMANENT", reason: "CUTOFF_BLOCKED", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: false };
    expect(shouldAttemptReward(denied)).toBe(false);
  });
});

describe("deriveRewardState", () => {
  it("sin ningún intento previo → NOT_EVALUATED", () => {
    expect(deriveRewardState(null, false)).toBe("NOT_EVALUATED");
  });
  it("GRANTED sin reversión → GRANTED", () => {
    const granted: RewardAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 1, generation: 0, retryable: false };
    expect(deriveRewardState(granted, false)).toBe("GRANTED");
  });
  it("GRANTED con el ledger ya revertido → REVERSED (nunca un booleano duplicado, se deriva del ledger real)", () => {
    const granted: RewardAttempt = { status: "GRANTED", reason: null, attempts: 1, lastAttemptAt: "x", ledgerId: 1, generation: 0, retryable: false };
    expect(deriveRewardState(granted, true)).toBe("REVERSED");
  });
  it("DENIED_TEMPORARY/DENIED_PERMANENT se devuelven tal cual", () => {
    const temp: RewardAttempt = { status: "DENIED_TEMPORARY", reason: "OUTSIDE_SCHEDULE", attempts: 1, lastAttemptAt: "x", ledgerId: null, generation: 0, retryable: true };
    expect(deriveRewardState(temp, false)).toBe("DENIED_TEMPORARY");
  });
});
