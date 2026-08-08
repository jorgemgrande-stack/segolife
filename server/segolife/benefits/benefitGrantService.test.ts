/**
 * benefitGrantService.test.ts — concesión atómica de Benefits: idempotencia
 * (incluida la carrera real vía ER_DUP_ENTRY), cancelación (UPDATE
 * condicional), expiración perezosa y los contadores de límites que usa
 * benefitRuleEngine.ts. Mismo patrón de mock que consumptionQrService.test.ts
 * (Fase 3) — estado real de fila(s), sin BD.
 */
import { describe, it, expect } from "vitest";
import {
  grantBenefit,
  cancelBenefit,
  expireBenefitIfNeeded,
  countGrantsByRuleForUser,
  countGrantsByRuleForUserSince,
  countGrantsByRuleTotal,
  hasGrantForOrigin,
  BenefitError,
} from "./benefitGrantService";

function blankUserBenefit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, userId: 42, benefitDefinitionId: 1, benefitRuleId: null,
    sourceType: "manual", sourceId: null, sourceVenueId: null, sourceEventId: null, sourceLedgerId: null,
    communityId: null, status: "active", grantedAt: new Date("2026-06-01"),
    validFrom: new Date("2026-06-01"), validUntil: null,
    usedAt: null, usedAtVenueId: null, usedAtEventId: null, usedByStaffUserId: null,
    qrToken: "plaintoken", qrTokenHash: "hash", idempotencyKey: null, metadata: null,
    grantedByUserId: null, cancelledAt: null, cancelledByUserId: null, cancellationReason: null,
    createdAt: new Date("2026-06-01"), updatedAt: new Date("2026-06-01"),
    ...overrides,
  };
}

/** Mock de una sola tabla (user_benefits) — soporta insert con detección de ER_DUP_ENTRY por idempotency_key, select por idempotencyKey/id, update condicional por status, y select "multi" (para los contadores de límites, que devuelven `rows.length`). */
function makeGrantMockDb(config: { rows?: Array<Record<string, unknown>>; nextId?: number } = {}) {
  const rows: Array<Record<string, unknown>> = config.rows ? [...config.rows] : [];
  let nextId = config.nextId ?? (rows.length > 0 ? Math.max(...rows.map(r => r.id as number)) + 1 : 1);
  let lastSelected: Array<Record<string, unknown>> = [];

  const b: any = {};
  let mode: "select" | "insert" | "update" = "select";
  let pendingFields: Record<string, unknown> = {};

  b.select = () => { mode = "select"; return b; };
  b.from = () => b;
  b.insert = () => { mode = "insert"; return b; };
  b.update = () => { mode = "update"; return b; };
  b.set = (f: Record<string, unknown>) => { pendingFields = f; return b; };
  b.limit = (n: number) => {
    if (mode === "select") lastSelected = lastSelected.slice(0, n);
    return b;
  };
  b.where = () => {
    if (mode === "update") {
      // Simulación simplificada: aplica a TODAS las filas activas (los tests
      // usan una única fila por mock) — condición real (status='active')
      // comprobada explícitamente cuando pendingFields incluye 'status'.
      let affected = 0;
      for (const row of rows) {
        if ("status" in pendingFields) {
          if (row.status === "active") { Object.assign(row, pendingFields); affected++; }
        } else {
          Object.assign(row, pendingFields);
          affected++;
        }
      }
      return Promise.resolve([{ affectedRows: affected }]);
    }
    // select: por simplicidad de test (una fila relevante por mock), se
    // devuelve el conjunto completo — cada test construye el mock con
    // exactamente las filas que espera que la query en curso encuentre.
    lastSelected = rows;
    return b;
  };
  b.values = (v: Record<string, unknown>) => {
    if (v.idempotencyKey != null) {
      const dup = rows.find(r => r.idempotencyKey === v.idempotencyKey);
      if (dup) {
        const err: any = new Error("ER_DUP_ENTRY");
        err.errno = 1062;
        throw err;
      }
    }
    const row = blankUserBenefit({ id: nextId++, ...v });
    rows.push(row);
    return Promise.resolve([{ insertId: row.id }]);
  };
  b.then = (resolve: (v: unknown) => void) => resolve(lastSelected);

  return { db: b as any, getRows: () => rows };
}

describe("benefitGrantService — grantBenefit", () => {
  it("concede un beneficio y genera un token de QR único en claro + su hash", async () => {
    const { db } = makeGrantMockDb();
    const granted = await grantBenefit({
      userId: 42, benefitDefinitionId: 1, sourceType: "manual",
      validFrom: new Date("2026-06-01"), validUntil: null,
    }, db);
    expect(granted.created).toBe(true);
    expect(granted.qrToken).toHaveLength(43); // base64url de 32 bytes
    expect(granted.benefit.qrTokenHash).not.toBe(granted.qrToken);
    expect(granted.benefit.qrTokenHash).toHaveLength(64); // SHA-256 hex
  });

  it("idempotencia — precheck: una idempotencyKey ya existente devuelve la fila existente sin duplicar", async () => {
    const existing = blankUserBenefit({ id: 5, idempotencyKey: "benefit_rule:1:consumption:99:user:42", qrToken: "already-issued-token" });
    const { db, getRows } = makeGrantMockDb({ rows: [existing] });
    const granted = await grantBenefit({
      userId: 42, benefitDefinitionId: 1, sourceType: "consumption",
      validFrom: new Date(), idempotencyKey: "benefit_rule:1:consumption:99:user:42",
    }, db);
    expect(granted.created).toBe(false);
    expect(granted.benefit.id).toBe(5);
    expect(granted.qrToken).toBe("already-issued-token"); // token en claro recuperable en la repetición
    expect(getRows()).toHaveLength(1); // no se insertó una segunda fila
  });

  it("idempotencia — carrera real: ER_DUP_ENTRY en el INSERT se captura y devuelve la fila ganadora, no un error", async () => {
    const { db, getRows } = makeGrantMockDb();
    const key = "benefit_rule:1:consumption:1:user:42";

    // Dos concesiones "simultáneas" con la misma idempotencyKey — sin fila
    // previa (el precheck de ambas no ve nada, igual que en una carrera
    // real de MySQL), la segunda en insertar debe chocar contra el UNIQUE.
    const [r1, r2] = await Promise.all([
      grantBenefit({ userId: 42, benefitDefinitionId: 1, sourceType: "consumption", validFrom: new Date(), idempotencyKey: key }, db),
      grantBenefit({ userId: 42, benefitDefinitionId: 1, sourceType: "consumption", validFrom: new Date(), idempotencyKey: key }, db),
    ]);

    expect([r1.created, r2.created].filter(Boolean)).toHaveLength(1); // solo una creó de verdad
    expect(r1.benefit.id).toBe(r2.benefit.id); // ambas devuelven la MISMA fila
    expect(getRows()).toHaveLength(1); // nunca se duplicó
  });

  it("una concesión manual sin idempotencyKey no comprueba duplicados (intencional)", async () => {
    const { db, getRows } = makeGrantMockDb();
    await grantBenefit({ userId: 42, benefitDefinitionId: 1, sourceType: "manual", validFrom: new Date() }, db);
    await grantBenefit({ userId: 42, benefitDefinitionId: 1, sourceType: "manual", validFrom: new Date() }, db);
    expect(getRows()).toHaveLength(2); // dos concesiones manuales distintas, ambas válidas
  });
});

describe("benefitGrantService — expireBenefitIfNeeded (expiración perezosa)", () => {
  it("un beneficio active con valid_until pasado se marca expired al tocarlo", async () => {
    const benefit = blankUserBenefit({ status: "active", validUntil: new Date("2020-01-01") });
    const { db } = makeGrantMockDb({ rows: [benefit] });
    const resolved = await expireBenefitIfNeeded(benefit as any, db);
    expect(resolved.status).toBe("expired");
  });

  it("un beneficio active con valid_until futuro NO cambia", async () => {
    const benefit = blankUserBenefit({ status: "active", validUntil: new Date("2099-01-01") });
    const { db } = makeGrantMockDb({ rows: [benefit] });
    const resolved = await expireBenefitIfNeeded(benefit as any, db);
    expect(resolved.status).toBe("active");
  });

  it("un beneficio sin valid_until (vigencia abierta) nunca expira automáticamente", async () => {
    const benefit = blankUserBenefit({ status: "active", validUntil: null });
    const { db } = makeGrantMockDb({ rows: [benefit] });
    const resolved = await expireBenefitIfNeeded(benefit as any, db);
    expect(resolved.status).toBe("active");
  });

  it("un beneficio ya used/cancelled no se toca aunque valid_until haya pasado", async () => {
    const benefit = blankUserBenefit({ status: "used", validUntil: new Date("2020-01-01") });
    const { db } = makeGrantMockDb({ rows: [benefit] });
    const resolved = await expireBenefitIfNeeded(benefit as any, db);
    expect(resolved.status).toBe("used");
  });
});

describe("benefitGrantService — cancelBenefit", () => {
  it("cancela un beneficio active y registra motivo/quién/cuándo", async () => {
    const benefit = blankUserBenefit();
    const { db } = makeGrantMockDb({ rows: [benefit] });
    const cancelled = await cancelBenefit({ userBenefitId: 1, reason: "Error administrativo", cancelledByUserId: 9 }, db);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toBe("Error administrativo");
    expect(cancelled.cancelledByUserId).toBe(9);
  });

  it("un beneficio ya used no se puede cancelar directamente (CANNOT_CANCEL)", async () => {
    const benefit = blankUserBenefit({ status: "used" });
    const { db } = makeGrantMockDb({ rows: [benefit] });
    await expect(cancelBenefit({ userBenefitId: 1, reason: "x", cancelledByUserId: 9 }, db))
      .rejects.toMatchObject({ code: "CANNOT_CANCEL" });
  });

  it("requiere un motivo no vacío", async () => {
    const benefit = blankUserBenefit();
    const { db } = makeGrantMockDb({ rows: [benefit] });
    await expect(cancelBenefit({ userBenefitId: 1, reason: "   ", cancelledByUserId: 9 }, db))
      .rejects.toBeInstanceOf(BenefitError);
  });
});

describe("benefitGrantService — contadores de límites", () => {
  // NOTA: el mock representa el resultado YA filtrado por el WHERE real de
  // Drizzle (mismo criterio documentado arriba en makeGrantMockDb) — estos
  // tests verifican el conteo/agregación, no la construcción del SQL en sí
  // (esa la cubre la validación de migración contra MySQL 9.4 real).

  it("countGrantsByRuleForUser cuenta las filas no canceladas ya filtradas por la query", async () => {
    const rows = [
      blankUserBenefit({ id: 1, benefitRuleId: 7, status: "active" }),
      blankUserBenefit({ id: 2, benefitRuleId: 7, status: "used" }),
    ];
    const { db } = makeGrantMockDb({ rows });
    const count = await countGrantsByRuleForUser(42, 7, db);
    expect(count).toBe(2);
  });

  it("countGrantsByRuleTotal cuenta todas las concesiones de la regla (cualquier usuario)", async () => {
    const rows = [
      blankUserBenefit({ id: 1, benefitRuleId: 7 }),
      blankUserBenefit({ id: 2, benefitRuleId: 7, userId: 99 }),
    ];
    const { db } = makeGrantMockDb({ rows });
    expect(await countGrantsByRuleTotal(7, db)).toBe(2);
  });

  it("countGrantsByRuleForUserSince respeta la ventana temporal (el mock ya devuelve las filas pre-filtradas)", async () => {
    const rows = [blankUserBenefit({ id: 1, benefitRuleId: 7, grantedAt: new Date("2026-06-05") })];
    const { db } = makeGrantMockDb({ rows });
    expect(await countGrantsByRuleForUserSince(42, 7, new Date("2026-06-01"), db)).toBe(1);
  });

  it("hasGrantForOrigin detecta una concesión previa para el mismo (regla, sourceType, sourceId)", async () => {
    const rows = [blankUserBenefit({ id: 1, benefitRuleId: 7, sourceType: "consumption", sourceId: 99 })];
    const { db } = makeGrantMockDb({ rows });
    expect(await hasGrantForOrigin(7, "consumption", 99, db)).toBe(true);
  });

  it("hasGrantForOrigin devuelve false si no hay ninguna fila previa", async () => {
    const { db } = makeGrantMockDb({ rows: [] });
    expect(await hasGrantForOrigin(7, "consumption", 99, db)).toBe(false);
  });
});
