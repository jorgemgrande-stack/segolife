/**
 * EventsManager.test.tsx — FIX-04 + FIX-05A. Cubre eventStatusBadge() y
 * eventOriginCaption(), las funciones puras que deciden qué muestra la
 * columna "Estado" del listado admin.
 *
 * FIX-04 corrigió que un evento finalizado (event 119) o un borrador de
 * Fourvenues (pre-opening-x-fcking-wednesdays) siguieran mostrando
 * "Activo". FIX-05A corrige un error de diseño real introducido en ESE
 * mismo cambio: la prioridad ponía el borrador de Fourvenues POR ENCIMA de
 * lo temporal, así que la mayoría del histórico real (sourcePublication
 * Status=null/unpublished — nunca confirmado, fuera de toda ventana de
 * sync, ver eventCatalogSync.ts) mostraba "Borrador Fourvenues" en vez de
 * "Finalizado". Prioridad correcta: FINALIZADO siempre gana para un evento
 * ya pasado, sea cual sea su origen — el providerStatus solo importa para
 * decidir el badge de un evento FUTURO.
 *
 * Sin render de componente: no hay convención previa de tests de
 * componente en este directorio, así que se prueban las funciones puras
 * directamente — mismo criterio que selectUpcomingWindow en
 * server/db/eventsDb.test.ts.
 */
import { describe, it, expect } from "vitest";
import { eventStatusBadge, eventOriginCaption } from "./EventsManager";

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "active", sourceType: null, sourcePublicationStatus: null,
    startsAt: new Date(now.getTime() + 10 * DAY_MS), endsAt: null,
    ...overrides,
  };
}

describe("eventStatusBadge — CASO A (event 119, finalizado nunca 'Activo')", () => {
  it("evento nativo activo y futuro -> 'Activo'", () => {
    expect(eventStatusBadge(baseEvent()).label).toBe("Activo");
  });

  it("evento nativo activo pero YA FINALIZADO (caso real: event 119, Fourvenues active/visible=true en origen, hace 11 meses) -> 'Finalizado', NUNCA 'Activo'", () => {
    const event119 = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published",
      startsAt: new Date(now.getTime() - 330 * DAY_MS),
    });
    expect(eventStatusBadge(event119).label).toBe("Finalizado");
  });

  it("status='inactive' gana siempre, incluso sobre un evento futuro (acción explícita del admin)", () => {
    expect(eventStatusBadge(baseEvent({ status: "inactive" })).label).toBe("Inactivo");
  });
});

describe("eventStatusBadge — CASO B (pre-opening-x-fcking-wednesdays, borrador de Fourvenues nunca 'Activo')", () => {
  it("evento Fourvenues FUTURO activo local + sourcePublicationStatus='unpublished' (caso real) -> 'Borrador Fourvenues'", () => {
    const preOpening = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished" });
    expect(eventStatusBadge(preOpening).label).toBe("Borrador Fourvenues");
  });

  it("evento Fourvenues FUTURO + sourcePublicationStatus='unknown' -> también 'Borrador Fourvenues' (fail-closed, nunca 'Activo' sin confirmación)", () => {
    const event = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unknown" });
    expect(eventStatusBadge(event).label).toBe("Borrador Fourvenues");
  });

  it("evento Fourvenues FUTURO + sourcePublicationStatus=null (nunca sincronizado tras la migración) -> 'Borrador Fourvenues'", () => {
    const event = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null });
    expect(eventStatusBadge(event).label).toBe("Borrador Fourvenues");
  });

  it("evento Fourvenues FUTURO + sourcePublicationStatus='published' -> 'Activo' (comportamiento normal)", () => {
    const event = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published" });
    expect(eventStatusBadge(event).label).toBe("Activo");
  });

  it("evento Weezevent (sourceType ajeno a Fourvenues) activo -> 'Activo', nunca sujeto al gate de borrador de Fourvenues", () => {
    const event = baseEvent({ sourceType: "weezevent", sourcePublicationStatus: null });
    expect(eventStatusBadge(event).label).toBe("Activo");
  });
});

describe("eventStatusBadge — FIX-05A: lo temporal SIEMPRE gana sobre el providerStatus para un evento ya pasado", () => {
  it("borrador Fourvenues (unpublished) que además ya finalizó -> 'Finalizado', NUNCA 'Borrador Fourvenues' — bug real corregido", () => {
    const event = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished",
      startsAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    expect(eventStatusBadge(event).label).toBe("Finalizado");
  });

  it("Fourvenues con sourcePublicationStatus=null (caso REAL más común: la mayoría del histórico nunca confirma su estado, fuera de toda ventana de sync) y YA PASADO -> 'Finalizado', nunca 'Borrador Fourvenues'", () => {
    const event = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null,
      startsAt: new Date(now.getTime() - 90 * DAY_MS),
    });
    expect(eventStatusBadge(event).label).toBe("Finalizado");
  });

  it("Fourvenues con sourcePublicationStatus='unknown' y YA PASADO -> 'Finalizado'", () => {
    const event = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unknown",
      startsAt: new Date(now.getTime() - 90 * DAY_MS),
    });
    expect(eventStatusBadge(event).label).toBe("Finalizado");
  });

  it("status='inactive' sigue ganando incluso sobre un evento pasado (acción explícita del admin, máxima prioridad)", () => {
    const event = baseEvent({ status: "inactive", startsAt: new Date(now.getTime() - 30 * DAY_MS) });
    expect(eventStatusBadge(event).label).toBe("Inactivo");
  });
});

describe("eventOriginCaption — trazabilidad secundaria (spec FIX-05A §4, 'no eliminar trazabilidad')", () => {
  it("evento Fourvenues YA FINALIZADO -> caption con el providerStatus real, nunca null", () => {
    const event = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "published",
      startsAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    expect(eventOriginCaption(event)).toBe("Fourvenues: publicado");
  });

  it("evento Fourvenues finalizado que nunca se publicó (unpublished) -> caption lo refleja", () => {
    const event = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished",
      startsAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    expect(eventOriginCaption(event)).toBe("Fourvenues: nunca publicado");
  });

  it("evento Fourvenues finalizado sin confirmar (null) -> caption 'sin confirmar'", () => {
    const event = baseEvent({
      sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: null,
      startsAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    expect(eventOriginCaption(event)).toBe("Fourvenues: sin confirmar");
  });

  it("evento Fourvenues FUTURO (no finalizado) -> sin caption (el badge principal 'Borrador Fourvenues' ya lo dice todo)", () => {
    const event = baseEvent({ sourceType: "integration:fourvenues_integrations", sourcePublicationStatus: "unpublished" });
    expect(eventOriginCaption(event)).toBeNull();
  });

  it("evento nativo (sin sourceType) YA FINALIZADO -> sin caption (nunca inventar un origen Fourvenues que no existe)", () => {
    const event = baseEvent({ startsAt: new Date(now.getTime() - 30 * DAY_MS) });
    expect(eventOriginCaption(event)).toBeNull();
  });
});
