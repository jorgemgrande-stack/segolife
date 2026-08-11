import { describe, it, expect } from "vitest";
import { paginateActivity, deriveLastActivityAt, deriveActivityCountInWindow } from "./studentActivityAggregator";
import type { TimelineEventDTO } from "../../../shared/segolife/student360";

function ev(id: string, occurredAt: string, type: TimelineEventDTO["type"] = "event_attendance"): TimelineEventDTO {
  return {
    id, occurredAt, type, title: id, description: null, source: "test",
    amountCents: null, tokens: null, venueName: null, eventName: null, metadata: null,
  };
}

// Orden desc por fecha, como lo produce getStudentActivitySnapshot.
const SORTED_FIXTURE: TimelineEventDTO[] = [
  ev("e5", "2026-08-10T10:00:00.000Z"),
  ev("e4", "2026-08-09T10:00:00.000Z"),
  ev("e3", "2026-08-08T10:00:00.000Z"),
  ev("e2", "2026-08-07T10:00:00.000Z", "internal_note"),
  ev("e1", "2026-08-06T10:00:00.000Z"),
];

describe("paginateActivity", () => {
  it("primera página respeta el orden cronológico descendente (más reciente primero)", () => {
    const page = paginateActivity(SORTED_FIXTURE, {}, null, 3);
    expect(page.items.map(i => i.id)).toEqual(["e5", "e4", "e3"]);
  });

  it("nextCursor apunta al último elemento de la página cuando hay más resultados", () => {
    const page = paginateActivity(SORTED_FIXTURE, {}, null, 3);
    expect(page.nextCursor).toEqual({ occurredAt: "2026-08-08T10:00:00.000Z", id: "e3" });
  });

  it("la segunda página con el cursor de la primera nunca repite ni salta elementos", () => {
    const first = paginateActivity(SORTED_FIXTURE, {}, null, 3);
    const second = paginateActivity(SORTED_FIXTURE, {}, first.nextCursor, 3);
    expect(second.items.map(i => i.id)).toEqual(["e2", "e1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("recorrido completo por cursores reconstruye exactamente la lista original, sin duplicados ni huecos", () => {
    const all: TimelineEventDTO[] = [];
    let cursor = null as ReturnType<typeof paginateActivity>["nextCursor"];
    do {
      const page = paginateActivity(SORTED_FIXTURE, {}, cursor, 2);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(all.map(i => i.id)).toEqual(SORTED_FIXTURE.map(i => i.id));
  });

  it("filtro por tipo excluye correctamente otros tipos", () => {
    const page = paginateActivity(SORTED_FIXTURE, { types: ["internal_note"] }, null, 10);
    expect(page.items.map(i => i.id)).toEqual(["e2"]);
  });

  it("filtro por rango de fechas (from/to) acota correctamente", () => {
    const page = paginateActivity(SORTED_FIXTURE, { from: "2026-08-08T00:00:00.000Z", to: "2026-08-09T23:59:59.000Z" }, null, 10);
    expect(page.items.map(i => i.id)).toEqual(["e4", "e3"]);
  });

  it("lista vacía no revienta y devuelve nextCursor null", () => {
    const page = paginateActivity([], {}, null, 10);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("deriveLastActivityAt", () => {
  it("devuelve la fecha del primer elemento (snapshot ya viene ordenado desc)", () => {
    expect(deriveLastActivityAt(SORTED_FIXTURE)).toBe("2026-08-10T10:00:00.000Z");
  });

  it("devuelve null si no hay ningún evento (nunca fabrica una fecha)", () => {
    expect(deriveLastActivityAt([])).toBeNull();
  });
});

describe("deriveActivityCountInWindow", () => {
  it("cuenta solo tipos de actividad de negocio dentro de la ventana, excluyendo notas/tags/login/admin_action", () => {
    const count = deriveActivityCountInWindow(SORTED_FIXTURE, "2026-08-05T00:00:00.000Z");
    // e2 es internal_note — no cuenta como actividad de negocio.
    expect(count).toBe(4);
  });

  it("respeta el límite inferior de la ventana", () => {
    const count = deriveActivityCountInWindow(SORTED_FIXTURE, "2026-08-09T00:00:00.000Z");
    expect(count).toBe(2); // e5, e4
  });

  it("ventana sin ningún evento devuelve 0, no revienta", () => {
    const count = deriveActivityCountInWindow(SORTED_FIXTURE, "2030-01-01T00:00:00.000Z");
    expect(count).toBe(0);
  });
});
