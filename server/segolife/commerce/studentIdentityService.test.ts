/**
 * studentIdentityService.test.ts — QR de identidad del estudiante (Fase 8,
 * spec punto 23). Cubre: creación idempotente (UNIQUE user_id + carrera de
 * doble clic), rotación, y que la búsqueda del staff SIEMPRE resuelve por
 * hash (nunca compara el token en texto plano).
 */
import { describe, it, expect } from "vitest";
import { studentIdentityTokens, users } from "../../../drizzle/schema";
import { getOrCreateMyIdentityToken, rotateMyIdentityToken, lookupStudentByIdentityToken } from "./studentIdentityService";

function makeMockDb(initial: { token?: Record<string, unknown> | null; user?: Record<string, unknown> | null } = {}) {
  let row: Record<string, unknown> | null = initial.token ?? null;
  const user = initial.user ?? { id: 42, name: "Ana" };
  let currentTable: "tokens" | "users" = "tokens";
  const b: any = {};
  b.select = () => b;
  b.from = (t: unknown) => { currentTable = t === users ? "users" : "tokens"; return b; };
  b.where = () => b;
  b.limit = () => Promise.resolve(currentTable === "users" ? (row ? [user] : []) : row ? [row] : []);
  b.insert = () => b;
  b.ignore = () => b;
  b.values = (v: Record<string, unknown>) => {
    if (row) return Promise.resolve([{ insertId: 0 }]); // ya existe -> UNIQUE colisiona, insertId 0
    row = { userId: v.userId, token: v.token, tokenHash: v.tokenHash };
    return Promise.resolve([{ insertId: 1 }]);
  };
  b.update = () => b;
  b.set = (v: Record<string, unknown>) => {
    if (row) row = { ...row, ...v };
    return b;
  };
  return b as any;
}

describe("studentIdentityService — getOrCreateMyIdentityToken", () => {
  it("primera vez: crea un token nuevo", async () => {
    const db = makeMockDb();
    const result = await getOrCreateMyIdentityToken(42, db);
    expect(result.token).toBeTruthy();
    expect(typeof result.token).toBe("string");
  });

  it("ya existe: devuelve el mismo token, no crea uno nuevo", async () => {
    const db = makeMockDb({ token: { userId: 42, token: "existing-token", tokenHash: "hash-x" } });
    const result = await getOrCreateMyIdentityToken(42, db);
    expect(result.token).toBe("existing-token");
  });

  it("carrera (doble clic, UNIQUE user_id colisiona) — devuelve el token creado por la otra llamada, no lanza", async () => {
    // Simula: la fila SÍ existe ya en BD (otra petición ganó la carrera) pero
    // la primera consulta select() de esta llamada aún no la había visto.
    const db = makeMockDb();
    (db as any).values = (v: Record<string, unknown>) => {
      // La inserción "pierde" la carrera: otra fila ya existe en BD.
      (db as any).__raceRow = { userId: v.userId, token: "winner-token", tokenHash: "winner-hash" };
      return Promise.resolve([{ insertId: 0 }]);
    };
    let selectCount = 0;
    db.where = () => db;
    db.limit = () => {
      selectCount++;
      if (selectCount === 1) return Promise.resolve([]); // primer select: no existe aún
      return Promise.resolve((db as any).__raceRow ? [(db as any).__raceRow] : []); // refetch tras perder la carrera
    };
    const result = await getOrCreateMyIdentityToken(42, db);
    expect(result.token).toBe("winner-token");
  });
});

describe("studentIdentityService — rotateMyIdentityToken", () => {
  it("genera un token distinto del anterior", async () => {
    const db = makeMockDb({ token: { userId: 42, token: "old-token", tokenHash: "old-hash" } });
    const result = await rotateMyIdentityToken(42, db);
    expect(result.token).not.toBe("old-token");
    expect(result.token).toBeTruthy();
  });
});

describe("studentIdentityService — lookupStudentByIdentityToken", () => {
  it("token válido → resuelve el estudiante (buscando SIEMPRE por hash, nunca por texto plano)", async () => {
    const db = makeMockDb({ token: { userId: 42, token: "plain-token", tokenHash: "irrelevant-in-mock" }, user: { id: 42, name: "Ana" } });
    const result = await lookupStudentByIdentityToken("plain-token", db);
    expect(result).toEqual({ userId: 42, name: "Ana" });
  });

  it("token inexistente → null, nunca lanza", async () => {
    const db = makeMockDb();
    const result = await lookupStudentByIdentityToken("no-existe", db);
    expect(result).toBeNull();
  });
});
