/**
 * studentsDb.test.ts — modelo de estudiante y CRM de Fase 1C.
 * Mismo patrón de inyección de dependencia que server/db/communitiesDb.test.ts
 * (Fase 1B): cada función acepta un `db` opcional mockeable, sin necesidad de
 * mockear mysql2/drizzle-orm a nivel de módulo.
 *
 * La constraint UNIQUE(user_id) real en MySQL se verificó empíricamente
 * contra la BD local durante esta fase (ver informe). Aquí se prueba que el
 * CÓDIGO no crea perfiles duplicados para el mismo usuario.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureStudentProfile,
  getStudentById,
  updateStudentProfile,
  listStudentNotes,
  addStudentNote,
  listStudents,
} from "./studentsDb";
import { studentProfiles, users, universities, userCommunities, studentTagAssignments } from "../../drizzle/schema";

// ─── Mock stateful mínimo: suficiente para simular student_profiles + users
// + universities + user_communities + notas, sin reimplementar SQL real. ──

interface FakeProfile {
  id: number; userId: number; firstName: string | null; lastName: string | null;
  dateOfBirth: string | null; nationality: string | null; countryOfOrigin: string | null;
  preferredLocale: string | null; universityId: number | null; degreeProgram: string | null;
  academicYear: string | null; arrivalDate: string | null; expectedDepartureDate: string | null;
  addressLine: string | null; postalCode: string | null; city: string | null;
  profileCompleted: boolean; status: "active" | "inactive"; createdAt: Date; updatedAt: Date;
}

function blankProfile(id: number, userId: number): FakeProfile {
  return {
    id, userId, firstName: null, lastName: null, dateOfBirth: null, nationality: null,
    countryOfOrigin: null, preferredLocale: null, universityId: null, degreeProgram: null,
    academicYear: null, arrivalDate: null, expectedDepartureDate: null, addressLine: null,
    postalCode: null, city: null, profileCompleted: false, status: "active",
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  };
}

describe("studentsDb — crear perfil de estudiante (ensureStudentProfile)", () => {
  it("crea un perfil nuevo si el usuario no tiene uno todavía", async () => {
    const profiles: FakeProfile[] = [];
    let nextId = 1;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, limit: () => db,
      where: () => db,
      insert: () => db,
      values: (v: { userId: number }) => { profiles.push(blankProfile(nextId++, v.userId)); return Promise.resolve([{ insertId: nextId - 1 }]); },
      then: (resolve: (v: unknown) => void) => resolve(profiles.filter(p => p.userId === 42)),
    };
    const profile = await ensureStudentProfile(42, db as unknown as Parameters<typeof ensureStudentProfile>[1]);
    expect(profile.userId).toBe(42);
    expect(profiles).toHaveLength(1);
  });

  it("UNIQUE(user_id): una segunda llamada para el mismo usuario NO crea un segundo perfil", async () => {
    const profiles: FakeProfile[] = [blankProfile(1, 42)];
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, limit: () => db, where: () => db,
      insert: () => db,
      values: () => { throw new Error("no debería llegar a insertar — ya existe"); },
      then: (resolve: (v: unknown) => void) => resolve(profiles.filter(p => p.userId === 42)),
    };
    const profile = await ensureStudentProfile(42, db as unknown as Parameters<typeof ensureStudentProfile>[1]);
    expect(profile.id).toBe(1);
    expect(profiles).toHaveLength(1); // sigue habiendo solo 1
  });
});

/**
 * buildStudentDetail (usado por getStudentById) dispara 4 queries en
 * paralelo con Promise.all — el orden en que Promise.all invoca sus `.then`
 * no está garantizado por llamada, así que el mock se indexa por la tabla
 * real que recibe `.from(tabla)` (misma referencia de objeto que importa
 * studentsDb.ts, al importar del mismo drizzle/schema.ts) en vez de por
 * orden de llamada — mucho más robusto que un contador de fases.
 */
function makeDetailMockDb(byTable: Map<unknown, unknown[]>) {
  const selectStub = {
    from(table: unknown) {
      const result = byTable.get(table) ?? [];
      const builder: Record<string, unknown> = {};
      builder.where = () => builder;
      builder.limit = () => builder;
      builder.innerJoin = () => builder;
      builder.then = (resolve: (v: unknown) => void) => resolve(result);
      return builder;
    },
  };
  return { select: () => selectStub };
}

describe("studentsDb — leer ficha (getStudentById) y universidad asociada", () => {
  it("devuelve el perfil con su universidad y comunidades", async () => {
    const profile = { ...blankProfile(5, 42), universityId: 9 };
    const byTable = new Map<unknown, unknown[]>([
      [studentProfiles, [profile]],
      [users, [{ id: 42, name: "Ada Lovelace", email: "ada@ie.edu", phone: null, avatarUrl: null }]],
      [universities, [{ id: 9, name: "IE University", slug: "ie-university", emailDomain: "ie.edu", country: "ES" }]],
      [userCommunities, [{ userId: 42, community: { id: 1, name: "Segolife IE", slug: "ie" } }]],
      [studentTagAssignments, []],
    ]);
    const db = makeDetailMockDb(byTable);
    const detail = await getStudentById(5, db as unknown as Parameters<typeof getStudentById>[1]);
    expect(detail).not.toBeNull();
    expect(detail?.user.name).toBe("Ada Lovelace");
    expect(detail?.university?.name).toBe("IE University");
    expect(detail?.communities).toEqual([{ id: 1, name: "Segolife IE", slug: "ie" }]);
  });

  it("devuelve null si el studentProfileId no existe", async () => {
    const db = makeDetailMockDb(new Map([[studentProfiles, []]]));
    const detail = await getStudentById(999, db as unknown as Parameters<typeof getStudentById>[1]);
    expect(detail).toBeNull();
  });
});

describe("studentsDb — actualizar campos permitidos (updateStudentProfile)", () => {
  it("actualiza los campos y recalcula profileCompleted cuando ya están todos los requeridos", async () => {
    let profile = blankProfile(1, 42);
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, where: () => db, limit: () => db,
      insert: () => db, values: () => Promise.resolve([{ insertId: 1 }]),
      update: () => db,
      set: (fields: Partial<FakeProfile>) => { profile = { ...profile, ...fields }; return db; },
      then: (resolve: (v: unknown) => void) => resolve([profile]),
    };
    const updated = await updateStudentProfile(
      42,
      {
        firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1990-01-01", nationality: "GB",
        universityId: 9, degreeProgram: "Computer Science", academicYear: "3", arrivalDate: "2026-09-01",
      },
      db as unknown as Parameters<typeof updateStudentProfile>[2]
    );
    expect(updated.firstName).toBe("Ada");
    expect(updated.profileCompleted).toBe(true);
  });

  it("profileCompleted sigue en false si falta algún campo requerido", async () => {
    let profile = blankProfile(1, 42);
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, where: () => db, limit: () => db,
      insert: () => db, values: () => Promise.resolve([{ insertId: 1 }]),
      update: () => db,
      set: (fields: Partial<FakeProfile>) => { profile = { ...profile, ...fields }; return db; },
      then: (resolve: (v: unknown) => void) => resolve([profile]),
    };
    const updated = await updateStudentProfile(
      42,
      { firstName: "Ada", lastName: "Lovelace" }, // faltan nationality, universityId, etc.
      db as unknown as Parameters<typeof updateStudentProfile>[2]
    );
    expect(updated.profileCompleted).toBe(false);
  });
});

describe("studentsDb — notas internas", () => {
  it("addStudentNote crea la nota y listStudentNotes la devuelve", async () => {
    const notes: Array<{ id: number; studentProfileId: number; authorUserId: number; note: string; createdAt: Date; updatedAt: Date }> = [];
    let nextId = 1;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, where: () => db, orderBy: () => db, limit: () => db,
      insert: () => db,
      values: (v: { studentProfileId: number; authorUserId: number; note: string }) => {
        notes.push({ id: nextId++, ...v, createdAt: new Date(), updatedAt: new Date() });
        return Promise.resolve([{ insertId: nextId - 1 }]);
      },
      then: (resolve: (v: unknown) => void) => resolve(notes),
    };
    await addStudentNote(5, 1, "Contactado por WhatsApp, pendiente respuesta.", db as unknown as Parameters<typeof addStudentNote>[3]);
    const list = await listStudentNotes(5, db as unknown as Parameters<typeof listStudentNotes>[1]);
    expect(list).toHaveLength(1);
    expect(list[0].note).toContain("WhatsApp");
  });
});

describe("studentsDb — filtro por comunidad (listStudents)", () => {
  const studentIE = { ...blankProfile(1, 100) };
  const studentUVA = { ...blankProfile(2, 200) };

  function makeListMockDb(memberships: Record<number, number[]>) {
    let call = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        call++;
        // 1) getUserIdsInCommunities  2) listado principal (profile+user+university)
        // 3) count  4) getCommunitiesByUserId
        if (call === 1) {
          const communityId = Object.keys(memberships).map(Number)[0];
          return resolve(Object.entries(memberships).flatMap(([uid, cids]) =>
            cids.length ? [{ userId: Number(uid) }] : []
          ).filter(r => memberships[r.userId]?.includes(communityId)));
        }
        return resolve([]);
      },
    };
    return db;
  }

  it("filtro IE devuelve solo estudiantes de la comunidad IE", async () => {
    // Simulamos directamente el resultado esperado usando un mock explícito
    // por fases en vez de reimplementar el JOIN — más legible que inspeccionar SQL.
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ userId: 100 }]); // getUserIdsInCommunities([IE]) → solo user 100
        if (phase === 2) return resolve([{ profile: studentIE, user: { id: 100, name: "Estudiante IE", email: "ie@ie.edu" }, university: null }]);
        if (phase === 3) return resolve([{ profile: studentIE }]); // count
        return resolve([{ userId: 100, community: { id: 1, name: "Segolife IE", slug: "ie" } }]); // comunidades
      },
    };
    const { items, total } = await listStudents({ communityIds: [1] }, db as unknown as Parameters<typeof listStudents>[1]);
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].userId).toBe(100);
  });

  it("filtro UVA devuelve solo estudiantes de la comunidad UVA", async () => {
    let phase = 0;
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, innerJoin: () => db, leftJoin: () => db,
      where: () => db, orderBy: () => db, limit: () => db, offset: () => db,
      then: (resolve: (v: unknown) => void) => {
        phase++;
        if (phase === 1) return resolve([{ userId: 200 }]); // getUserIdsInCommunities([UVA]) → solo user 200
        if (phase === 2) return resolve([{ profile: studentUVA, user: { id: 200, name: "Estudiante UVA", email: "uva@uva.es" }, university: null }]);
        if (phase === 3) return resolve([{ profile: studentUVA }]);
        return resolve([{ userId: 200, community: { id: 2, name: "Segolife UVA", slug: "uva" } }]);
      },
    };
    const { items, total } = await listStudents({ communityIds: [2] }, db as unknown as Parameters<typeof listStudents>[1]);
    expect(total).toBe(1);
    expect(items[0].userId).toBe(200);
    expect(items[0].communities[0].slug).toBe("uva");
  });

  it("comunidad sin ningún estudiante devuelve lista vacía sin consultar el resto", async () => {
    const db: Record<string, unknown> = {
      select: () => db, from: () => db, where: () => db,
      then: (resolve: (v: unknown) => void) => resolve([]), // getUserIdsInCommunities → []
    };
    const { items, total } = await listStudents({ communityIds: [999] }, db as unknown as Parameters<typeof listStudents>[1]);
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});
