/**
 * unresolvedOperationsService.test.ts — vinculación manual y descarte de
 * operaciones no resueltas (Fase 5, punto 34). Estados: unresolved → linked
 * | ignored. Nunca se puede volver a resolver una operación ya resuelta
 * (evita doble-procesado si el admin hace doble clic).
 */
import { describe, it, expect, vi } from "vitest";

const { mockPersistIdentityMapping } = vi.hoisted(() => ({ mockPersistIdentityMapping: vi.fn() }));
vi.mock("./identityResolver", () => ({ persistIdentityMapping: mockPersistIdentityMapping }));

import { linkUnresolvedOperation, ignoreUnresolvedOperation, UnresolvedOperationError } from "./unresolvedOperationsService";

function fakeDb({ existing = null as unknown } = {}) {
  const updates: Record<string, unknown>[] = [];
  let selectCallIndex = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCallIndex++;
            if (selectCallIndex === 1) return existing ? [existing] : [];
            // 2ª select = releer tras el update, reflejando lo último aplicado.
            return [{ ...existing, ...updates[updates.length - 1] }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push(values); return [{}]; },
      }),
    }),
  } as never;
}

describe("linkUnresolvedOperation", () => {
  it("operación inexistente → NOT_FOUND", async () => {
    const db = fakeDb();
    await expect(linkUnresolvedOperation(999, 42, 1, db)).rejects.toThrow(UnresolvedOperationError);
  });

  it("operación ya vinculada (status != unresolved) → ALREADY_RESOLVED, nunca se reprocesa dos veces", async () => {
    const db = fakeDb({ existing: { id: 1, status: "linked" } });
    await expect(linkUnresolvedOperation(1, 42, 1, db)).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
  });

  it("vincula correctamente, persiste el mapping de identidad con method='manual'", async () => {
    const db = fakeDb({ existing: { id: 1, status: "unresolved", provider: "weezevent", identityHintEmail: "x@example.invalid", identityHintPhone: null, identityHintName: "X" } });
    const result = await linkUnresolvedOperation(1, 42, 7, db);
    expect(result.status).toBe("linked");
    expect(mockPersistIdentityMapping).toHaveBeenCalledOnce();
    expect(mockPersistIdentityMapping.mock.calls[0][0]).toMatchObject({ userId: 42, method: "manual" });
  });

  it("sin identity hints, no intenta persistir un mapping vacío", async () => {
    mockPersistIdentityMapping.mockClear();
    const db = fakeDb({ existing: { id: 2, status: "unresolved", provider: "fourvenues", identityHintEmail: null, identityHintPhone: null, identityHintName: null } });
    await linkUnresolvedOperation(2, 42, 7, db);
    expect(mockPersistIdentityMapping).not.toHaveBeenCalled();
  });
});

describe("ignoreUnresolvedOperation", () => {
  it("descarta una operación unresolved → status='ignored'", async () => {
    const db = fakeDb({ existing: { id: 3, status: "unresolved" } });
    const result = await ignoreUnresolvedOperation(3, 7, db);
    expect(result.status).toBe("ignored");
  });

  it("no se puede ignorar una operación ya vinculada", async () => {
    const db = fakeDb({ existing: { id: 3, status: "linked" } });
    await expect(ignoreUnresolvedOperation(3, 7, db)).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
  });
});
